from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import math
import threading
import time
from typing import Any

from django.db import close_old_connections
from django.utils import timezone

from homehub.core.models import Device, DeviceLocation
from homehub.core.services.accounts import get_active_account, get_credentials


logger = logging.getLogger(__name__)


@dataclass
class _CloudSession:
    device_id: int
    fingerprint: tuple[int, str, str, str, str]
    config: dict[str, Any]
    credentials: dict[str, Any] = field(repr=False)
    stop: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    status: str = "starting"
    error: str = ""
    connected: bool = False
    message_count: int = 0
    position_count: int = 0
    last_message_at: float | None = None
    last_location: dict[str, Any] | None = None
    last_persisted: tuple[float, float, float] | None = None


class RoombaCloudTrackingManager:
    """Consume iRobot's cloud live-map stream for firmware without local pose."""

    RETRY_SECONDS = 60.0

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[int, _CloudSession] = {}

    @staticmethod
    def _account_and_credentials(config: dict[str, Any]):
        configured_id = config.get("irobot_account_id")
        account_id = None
        if configured_id not in (None, ""):
            try:
                account_id = int(configured_id)
            except (TypeError, ValueError):
                return None, None

        try:
            account = get_active_account("irobot", account_id=account_id)
        except Exception:
            return None, None

        if account.status != "connected":
            return account, None
        return account, get_credentials(account)

    def ensure(self, device: Device, config: dict[str, Any]) -> None:
        blid = str(config.get("blid") or "").strip()
        if not blid:
            return

        account, credentials = self._account_and_credentials(config)
        if account is None or not credentials:
            return

        username = str(credentials.get("username") or "").strip()
        password = str(credentials.get("password") or "")
        country = str(credentials.get("country_code") or "GB").strip().upper()
        if not username or not password or len(country) != 2:
            return

        fingerprint = (account.id, username, password, country, blid)
        with self._lock:
            existing = self._sessions.get(device.id)
            if existing and existing.fingerprint == fingerprint:
                if existing.thread and existing.thread.is_alive():
                    return
                self._sessions.pop(device.id, None)

        if existing:
            self.stop(device.id)

        session = _CloudSession(
            device_id=device.id,
            fingerprint=fingerprint,
            config=dict(config),
            credentials={
                "username": username,
                "password": password,
                "country_code": country,
                "blid": blid,
            },
        )
        thread = threading.Thread(
            target=self._run,
            args=(session,),
            name=f"homehub-roomba-cloud-{device.id}",
            daemon=True,
        )
        session.thread = thread

        with self._lock:
            self._sessions[device.id] = session
        thread.start()

    def _run(self, session: _CloudSession) -> None:
        try:
            asyncio.run(self._run_async(session))
        except Exception as exc:
            session.status = "error"
            session.error = str(exc) or exc.__class__.__name__
            logger.exception(
                "Roomba cloud tracking worker stopped for device %s",
                session.device_id,
            )

    async def _run_async(self, session: _CloudSession) -> None:
        import aiohttp
        from roombapy_prime import PrimeFactory
        from roombapy_prime.models.livemap import PositionUpdateMessage

        while not session.stop.is_set():
            robot = None
            try:
                session.status = "connecting"
                session.error = ""
                timeout = aiohttp.ClientTimeout(total=40)
                async with aiohttp.ClientSession(timeout=timeout) as http:
                    robot = await PrimeFactory.create_prime_robot(
                        session=http,
                        username=session.credentials["username"],
                        password=session.credentials["password"],
                        country_code=session.credentials["country_code"],
                        blid=session.credentials["blid"],
                        auto_refresh=True,
                    )
                    await robot.connect(timeout=12)
                    session.connected = True
                    session.status = "waiting_for_position"

                    async for message in robot.watch_live_map():
                        if session.stop.is_set():
                            break

                        session.message_count += 1
                        session.last_message_at = time.time()
                        if not isinstance(message, PositionUpdateMessage):
                            continue
                        if not message.updates:
                            continue

                        sample = message.updates[-1]
                        location = self._location(
                            float(sample.point[0]),
                            float(sample.point[1]),
                            math.degrees(float(sample.orientation)),
                            session.config,
                        )
                        session.position_count += 1
                        session.last_location = location
                        session.status = "live"
                        session.error = ""
                        self._persist(session, location)
            except Exception as exc:
                session.connected = False
                session.status = "error"
                session.error = str(exc) or exc.__class__.__name__
                logger.warning(
                    "Roomba cloud live-map tracking failed for device %s: %s",
                    session.device_id,
                    session.error,
                )
            finally:
                if robot is not None:
                    try:
                        await robot.disconnect()
                    except Exception:
                        pass
                session.connected = False

            if session.stop.is_set():
                break
            await asyncio.to_thread(session.stop.wait, self.RETRY_SECONDS)

    @staticmethod
    def _location(
        metre_x: float,
        metre_y: float,
        heading: float,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        # The cloud live-map wire format uses metres. HomeHub's existing
        # Roomba floor-plan calibration is based on the classic pose scale,
        # so expose centimetres to keep the coordinate magnitude practical
        # and consistent with the local tracking path.
        raw_x = metre_x * 100.0
        raw_y = metre_y * 100.0
        scale_x = float(config.get("map_scale_x", 1) or 1)
        scale_y = float(config.get("map_scale_y", 1) or 1)
        offset_x = float(config.get("map_offset_x", 0) or 0)
        offset_y = float(config.get("map_offset_y", 0) or 0)
        return {
            "x": raw_x * scale_x + offset_x,
            "y": raw_y * scale_y + offset_y,
            "heading": heading,
            "raw_x": raw_x,
            "raw_y": raw_y,
            "raw_units": "centimetres",
            "source": "roomba_cloud_livemap",
        }

    def _persist(self, session: _CloudSession, location: dict[str, Any]) -> None:
        point = (
            float(location["x"]),
            float(location["y"]),
            float(location.get("heading") or 0),
        )
        if session.last_persisted == point:
            return
        session.last_persisted = point

        close_old_connections()
        try:
            try:
                device = Device.objects.get(pk=session.device_id)
            except Device.DoesNotExist:
                session.stop.set()
                return

            state = dict(device.state or {})
            state["location"] = location
            state["tracking_status"] = "live_cloud"
            state["cloud_tracking"] = {
                "status": "live",
                "source": "irobot_cloud_livemap",
                "updated_at": timezone.now().isoformat(),
            }
            device.state = state
            device.last_seen = timezone.now()
            device.save(update_fields=["state", "last_seen"])

            linked_object = (
                device.floorplan_objects.select_related("floor_plan")
                .order_by("id")
                .first()
            )
            DeviceLocation.objects.create(
                device=device,
                floor_plan=linked_object.floor_plan if linked_object else None,
                x=point[0],
                y=point[1],
                heading=point[2],
                source="roomba_cloud_livemap",
            )
        finally:
            close_old_connections()

    def location(self, device_id: int) -> dict[str, Any] | None:
        with self._lock:
            session = self._sessions.get(device_id)
        return dict(session.last_location) if session and session.last_location else None

    def diagnostics(
        self,
        device_id: int,
        *,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            session = self._sessions.get(device_id)

        if not session:
            account, credentials = self._account_and_credentials(config or {})
            return {
                "configured": bool(account and credentials),
                "account_status": getattr(account, "status", None),
                "session_exists": False,
                "status": "not_started" if account and credentials else "account_required",
            }

        now = time.time()
        return {
            "configured": True,
            "session_exists": True,
            "thread_alive": bool(session.thread and session.thread.is_alive()),
            "connected": session.connected,
            "status": session.status,
            "error": session.error,
            "message_count": session.message_count,
            "position_count": session.position_count,
            "seconds_since_message": (
                round(now - session.last_message_at, 2)
                if session.last_message_at is not None
                else None
            ),
            "location": session.last_location,
        }

    def stop(self, device_id: int) -> None:
        with self._lock:
            session = self._sessions.pop(device_id, None)
        if not session:
            return
        session.stop.set()


roomba_cloud_tracking_manager = RoombaCloudTrackingManager()
