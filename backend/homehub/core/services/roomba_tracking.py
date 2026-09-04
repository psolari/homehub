from __future__ import annotations

from dataclasses import dataclass, field
import threading
import time
from typing import Any

from django.db import close_old_connections
from django.utils import timezone

from homehub.core.models import Device, DeviceLocation


def _reported_state(client) -> dict[str, Any]:
    master = getattr(client, "master_state", None) or {}
    if not isinstance(master, dict):
        return {}
    state = master.get("state", master)
    if not isinstance(state, dict):
        return {}
    reported = state.get("reported", state)
    return reported if isinstance(reported, dict) else {}


def extract_roomba_location(
    client,
    config: dict[str, Any],
) -> dict[str, float] | None:
    """Return Roomba map coordinates in the library's intended orientation.

    roombapy 1.9.x deliberately swaps the robot's reported pose point x/y into
    its co_ords map attribute. Prefer that public compatibility attribute once
    a pose has actually been received rather than re-parsing the raw payload in
    a different orientation.
    """
    reported = _reported_state(client)
    pose = reported.get("pose")
    pose2 = reported.get("pose2")
    has_pose = isinstance(pose, dict) or isinstance(pose2, dict)
    if not has_pose:
        return None

    raw_x: float
    raw_y: float
    heading: float

    coords = getattr(client, "co_ords", None)
    if (
        isinstance(coords, dict)
        and coords.get("x") is not None
        and coords.get("y") is not None
    ):
        try:
            raw_x = float(coords["x"])
            raw_y = float(coords["y"])
            heading = float(coords.get("theta") or 0)
        except (TypeError, ValueError):
            return None
    else:
        source = pose if isinstance(pose, dict) else pose2
        point = source.get("point", source) if isinstance(source, dict) else {}
        if not isinstance(point, dict):
            return None
        try:
            # Match roombapy 1.9.x's map orientation.
            raw_x = float(point["y"])
            raw_y = float(point["x"])
            heading = float(source.get("theta") or 0)
        except (KeyError, TypeError, ValueError):
            return None

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
    }


def build_roomba_state(
    client,
    config: dict[str, Any],
) -> dict[str, Any]:
    reported = _reported_state(client)
    mission = reported.get("cleanMissionStatus") or {}
    if not isinstance(mission, dict):
        mission = {}

    phase = str(
        mission.get("phase")
        or getattr(client, "cleanMissionStatus_phase", "")
        or "unknown"
    )
    location = extract_roomba_location(client, config)

    running_phases = {
        "run",
        "hmUsrDock",
        "hmMidMsn",
        "hmPostMsn",
        "evac",
    }

    bin_state = reported.get("bin")
    return {
        "online": bool(getattr(client, "roomba_connected", True)),
        "status": "running" if phase in running_phases else "idle",
        "power": "on",
        "battery": reported.get("batPct"),
        "phase": phase,
        "mission": mission,
        "location": location,
        "tracking_status": "live" if location else "waiting_for_pose",
        "bin_full": bool(bin_state.get("full"))
        if isinstance(bin_state, dict)
        else None,
    }


@dataclass
class _RoombaSession:
    device_id: int
    fingerprint: tuple[str, str, str]
    client: Any
    config: dict[str, Any]
    ready: threading.Event = field(default_factory=threading.Event)
    last_location: tuple[float, float, float] | None = None
    last_write: float = 0.0


class RoombaTrackingManager:
    """Keep one long-lived local MQTT connection per configured Roomba."""

    MIN_WRITE_INTERVAL = 0.75

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[int, _RoombaSession] = {}

    @staticmethod
    def _fingerprint(
        device: Device,
        config: dict[str, Any],
    ) -> tuple[str, str, str]:
        return (
            str(device.ip_address or ""),
            str(config.get("blid") or ""),
            str(config.get("password") or ""),
        )

    def ensure(self, device: Device, config: dict[str, Any]):
        fingerprint = self._fingerprint(device, config)

        with self._lock:
            existing = self._sessions.get(device.id)
            if existing and existing.fingerprint == fingerprint:
                return existing.client

        if existing:
            self.stop(device.id)

        try:
            from roombapy.roomba_factory import RoombaFactory
        except ImportError as exc:
            raise RuntimeError("roombapy is not installed") from exc

        address, blid, password = fingerprint
        client = RoombaFactory.create_roomba(
            address=address,
            blid=blid,
            password=password,
            continuous=True,
        )
        session = _RoombaSession(
            device_id=device.id,
            fingerprint=fingerprint,
            client=client,
            config=dict(config),
        )

        def on_message(_message) -> None:
            session.ready.set()
            self._persist(session)

        def on_disconnect(_error) -> None:
            session.ready.clear()

        client.register_on_message_callback(on_message)
        client.register_on_disconnect_callback(on_disconnect)

        with self._lock:
            self._sessions[device.id] = session

        try:
            client.connect()
        except Exception:
            with self._lock:
                self._sessions.pop(device.id, None)
            raise

        return client

    def wait_until_ready(self, device_id: int, timeout: float = 2.5) -> bool:
        with self._lock:
            session = self._sessions.get(device_id)
        if not session:
            return False
        return session.ready.wait(timeout)

    def state(self, device_id: int) -> dict[str, Any] | None:
        with self._lock:
            session = self._sessions.get(device_id)
        if not session:
            return None
        return build_roomba_state(session.client, session.config)

    def client(self, device_id: int):
        with self._lock:
            session = self._sessions.get(device_id)
        return session.client if session else None

    def _persist(self, session: _RoombaSession) -> None:
        now = time.monotonic()
        if now - session.last_write < self.MIN_WRITE_INTERVAL:
            return

        state = build_roomba_state(session.client, session.config)
        location = state.get("location")
        session.last_write = now

        close_old_connections()
        try:
            device = Device.objects.get(pk=session.device_id)
            merged_state = {**(device.state or {}), **state}
            device.state = merged_state
            device.is_online = bool(state.get("online", True))
            device.status = str(state.get("status") or device.status)
            device.last_seen = timezone.now()
            device.save(
                update_fields=[
                    "state",
                    "is_online",
                    "status",
                    "last_seen",
                ]
            )

            if not isinstance(location, dict):
                return

            point = (
                float(location["x"]),
                float(location["y"]),
                float(location.get("heading") or 0),
            )
            if session.last_location == point:
                return
            session.last_location = point

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
                source="roomba_mqtt",
            )
        finally:
            close_old_connections()

    def stop(self, device_id: int) -> None:
        with self._lock:
            session = self._sessions.pop(device_id, None)
        if not session:
            return
        try:
            session.client.disconnect()
        except Exception:
            pass


roomba_tracking_manager = RoombaTrackingManager()
