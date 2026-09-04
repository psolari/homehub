from __future__ import annotations

import asyncio
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
import threading
import time
from typing import Any

from homehub.core.integrations.base import IntegrationError
from homehub.core.models import Device
from homehub.core.services.accounts import (
    get_account_credentials,
    get_active_account,
    set_account_credentials,
)
from homehub.core.services.ring_client import (
    close_ring_session,
    open_ring_session,
    ring_device_groups,
    ring_device_identity,
)


@dataclass
class _LiveSession:
    session_id: str
    device_id: int
    ring: Any
    ring_device: Any
    created_at: float = field(default_factory=time.monotonic)
    last_touch: float = field(default_factory=time.monotonic)
    sequence: int = 0
    messages: list[dict[str, Any]] = field(default_factory=list)


class RingLiveViewManager:
    """Own Ring WebRTC sessions on one persistent asyncio loop.

    Django's development server is WSGI. Running Ring's WebRTC stream with
    asyncio.run() would tear down the reader/pinger tasks as soon as the HTTP
    request returned, so live sessions are kept on a dedicated daemon loop.
    """

    SESSION_IDLE_TIMEOUT = 45
    MAX_MESSAGES = 200

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._lock = threading.RLock()
        self._sessions: dict[str, _LiveSession] = {}

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop and self._thread and self._thread.is_alive():
                return self._loop

            self._ready.clear()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="homehub-ring-webrtc",
                daemon=True,
            )
            self._thread.start()

        if not self._ready.wait(timeout=5):
            raise IntegrationError("HomeHub could not start the Ring live-view worker.")

        assert self._loop is not None
        return self._loop

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        with self._lock:
            self._loop = loop
        loop.create_task(self._watchdog())
        self._ready.set()
        loop.run_forever()

    def _submit(self, coroutine, *, timeout: float = 20):
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(coroutine, loop)
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise IntegrationError("Ring live-view signaling timed out.") from exc

    @staticmethod
    def ice_servers() -> list[dict[str, str]]:
        from ring_doorbell.const import ICE_SERVERS

        return [{"urls": url} for url in ICE_SERVERS]

    def start(
        self,
        device: Device,
        *,
        session_id: str,
        sdp_offer: str,
    ) -> dict[str, Any]:
        if device.model != "ring_camera":
            raise IntegrationError("Live View is currently available for Ring cameras only.")
        if not session_id or not sdp_offer:
            raise IntegrationError("session_id and offer are required.")

        account_id = (device.config or {}).get("account_id")
        account = get_active_account("ring", account_id=account_id)
        credentials = get_account_credentials(account)
        config = dict(device.config or {})

        result = self._submit(
            self._start_async(
                device_id=device.id,
                config=config,
                credentials=credentials,
                session_id=session_id,
                sdp_offer=sdp_offer,
            ),
            timeout=20,
        )

        refreshed_token = result.pop("_token", None)
        if refreshed_token:
            set_account_credentials(account, {"token": refreshed_token})
        return result

    async def _start_async(
        self,
        *,
        device_id: int,
        config: dict[str, Any],
        credentials: dict[str, Any],
        session_id: str,
        sdp_offer: str,
    ) -> dict[str, Any]:
        await self._stop_async(session_id, missing_ok=True)

        ring, token = await open_ring_session(credentials)
        wanted = str(config.get("ring_device_id") or "")
        ring_device = None
        for values in ring_device_groups(ring).values():
            for candidate in values:
                if ring_device_identity(candidate) == wanted:
                    ring_device = candidate
                    break
            if ring_device is not None:
                break

        if ring_device is None:
            await close_ring_session(ring)
            raise IntegrationError("Ring camera was not found for Live View.")

        session = _LiveSession(
            session_id=session_id,
            device_id=device_id,
            ring=ring,
            ring_device=ring_device,
        )
        with self._lock:
            self._sessions[session_id] = session

        def on_message(message) -> None:
            payload: dict[str, Any]
            if getattr(message, "error_code", None):
                payload = {
                    "type": "error",
                    "code": str(message.error_code),
                    "message": str(getattr(message, "error_message", "") or "Ring ended Live View."),
                }
            elif getattr(message, "answer", None):
                payload = {
                    "type": "answer",
                    "sdp": str(message.answer),
                }
            elif getattr(message, "candidate", None):
                payload = {
                    "type": "candidate",
                    "candidate": str(message.candidate),
                    "sdp_m_line_index": int(
                        getattr(message, "sdp_m_line_index", 0) or 0
                    ),
                }
            else:
                return
            self._append_message(session_id, payload)

        try:
            await ring_device.generate_async_webrtc_stream(
                sdp_offer,
                session_id,
                on_message,
                keep_alive_timeout=None,
            )
        except Exception:
            with self._lock:
                self._sessions.pop(session_id, None)
            await close_ring_session(ring)
            raise

        return {
            "session_id": session_id,
            "ice_servers": self.ice_servers(),
            "_token": token,
        }

    def _append_message(self, session_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.sequence += 1
            session.last_touch = time.monotonic()
            session.messages.append({"seq": session.sequence, **payload})
            if len(session.messages) > self.MAX_MESSAGES:
                session.messages = session.messages[-self.MAX_MESSAGES :]

    def messages(self, session_id: str, *, after: int = 0) -> dict[str, Any]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise IntegrationError("Ring Live View session is no longer active.")
            session.last_touch = time.monotonic()
            items = [item.copy() for item in session.messages if int(item["seq"]) > after]
            cursor = session.sequence
        return {
            "session_id": session_id,
            "cursor": cursor,
            "messages": items,
        }

    def candidate(
        self,
        session_id: str,
        *,
        candidate: str,
        sdp_m_line_index: int,
    ) -> None:
        if not candidate:
            return
        self._submit(
            self._candidate_async(
                session_id,
                candidate,
                sdp_m_line_index,
            ),
            timeout=8,
        )

    async def _candidate_async(
        self,
        session_id: str,
        candidate: str,
        sdp_m_line_index: int,
    ) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise IntegrationError("Ring Live View session is no longer active.")
            session.last_touch = time.monotonic()
            ring_device = session.ring_device

        await ring_device.on_webrtc_candidate(
            session_id,
            candidate,
            int(sdp_m_line_index),
        )

    def stop(self, session_id: str) -> None:
        if not session_id:
            return
        self._submit(self._stop_async(session_id, missing_ok=True), timeout=8)

    async def _stop_async(self, session_id: str, *, missing_ok: bool) -> None:
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            if missing_ok:
                return
            raise IntegrationError("Ring Live View session is no longer active.")

        try:
            await session.ring_device.close_webrtc_stream(session_id)
        finally:
            await close_ring_session(session.ring)

    async def _watchdog(self) -> None:
        while True:
            await asyncio.sleep(5)
            now = time.monotonic()
            with self._lock:
                expired = [
                    session_id
                    for session_id, session in self._sessions.items()
                    if now - session.last_touch > self.SESSION_IDLE_TIMEOUT
                ]
            for session_id in expired:
                try:
                    await self._stop_async(session_id, missing_ok=True)
                except Exception:
                    # Watchdog cleanup must never terminate the worker loop.
                    pass


ring_live_view_manager = RingLiveViewManager()
