import asyncio

from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver
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


@register_driver
class RingCameraDriver(BaseDriver):
    driver_key = "ring_camera"
    device_type = "camera"
    display_name = "Ring Camera / Doorbell"
    manufacturer = "Ring"
    config_schema = [
        {
            "name": "account_id",
            "label": "Ring account",
            "type": "number",
            "required": True,
            "description": "The HomeHub Ring integration account that owns this camera or doorbell.",
        },
        {
            "name": "ring_device_id",
            "label": "Ring device ID",
            "type": "string",
            "required": True,
            "description": "Usually supplied automatically by Ring cloud discovery.",
        },
        {
            "name": "family",
            "label": "Ring family",
            "type": "string",
            "required": False,
            "description": "Doorbell/camera family returned by Ring discovery.",
        },
    ]
    setup_schema = {
        "description": "Link a Ring camera or doorbell to a configured Ring account and verify camera access.",
        "requires_ip": False,
        "instructions": [
            "Ring devices are linked through your Ring account rather than by local IP address.",
            "Choose or configure a Ring account. Ring may ask for a one-time two-factor authentication code on first connection.",
            "For devices discovered from Ring, the Ring device ID and family are filled automatically.",
        ],
        "account_provider": "ring",
        "account_field": "account_id",
        "test_connection": True,
        "advanced_fields": ["family"],
    }
    controls = [
        Control("lights", "Lights", type="toggle", group="security", state_key="lights", parameter="value", icon="light"),
        Control("siren", "Siren", type="toggle", group="security", state_key="siren", parameter="value", icon="siren"),
        Control("snapshot", "Refresh camera", group="camera"),
    ]

    async def _ring(self):
        account = await self.to_thread(
            get_active_account,
            "ring",
            self.config.get("account_id"),
        )
        credentials = await self.to_thread(get_account_credentials, account)
        ring, token = await open_ring_session(credentials)
        if token:
            await self.to_thread(set_account_credentials, account, {"token": token})
        return ring

    async def _device(self):
        ring = await self._ring()
        wanted = str(self.config.get("ring_device_id") or "")
        for family, values in ring_device_groups(ring).items():
            for device in values:
                identity = ring_device_identity(device)
                if identity == wanted or str(getattr(device, "name", "")) == wanted:
                    return device, family, ring
        await close_ring_session(ring)
        raise IntegrationError("Ring device was not found")

    @staticmethod
    def _attr(obj, name, default=None):
        value = getattr(obj, name, default)
        try:
            return value() if callable(value) else value
        except Exception:
            return default

    async def get_state(self):
        device, family, ring = await self._device()
        try:
            return {
                "online": True,
                "status": "on",
                "power": "on",
                "family": family,
                "battery": self._attr(device, "battery_life"),
                "wifi_signal": self._attr(device, "wifi_signal_strength"),
                "lights": self._attr(device, "lights"),
                "siren": self._attr(device, "siren"),
                "camera_available": family in {"doorbells", "doorbots", "stickup_cams", "cameras"},
            }
        finally:
            await close_ring_session(ring)

    async def _set(self, names, value=None):
        device, _, ring = await self._device()
        try:
            for name in names:
                function = getattr(device, name, None)
                if not function:
                    continue
                if name.startswith("async_"):
                    result = function() if value is None else function(value)
                    return await result
                # python-ring-doorbell deliberately rejects its deprecated sync
                # wrappers from a running event loop. Keep compatibility with older
                # installs by executing a sync fallback in a worker thread.
                if value is None:
                    return await self.to_thread(function)
                return await self.to_thread(function, value)
            raise IntegrationError(f"Ring operation is not available: {names[0]}")
        finally:
            await close_ring_session(ring)

    async def action_lights(self, value):
        return await self._set(("async_set_lights", "set_lights"), bool(value))

    async def action_lights_on(self):
        return await self.action_lights(True)

    async def action_lights_off(self):
        return await self.action_lights(False)

    async def action_siren(self, value):
        return await self._set(("async_set_siren", "set_siren"), bool(value))

    async def action_siren_on(self):
        return await self.action_siren(True)

    async def action_siren_off(self):
        return await self.action_siren(False)

    async def action_snapshot(self):
        return {"available": (await self.camera_frame()) is not None}

    async def camera_frame(self):
        device, _, ring = await self._device()
        try:
            async_snapshot = getattr(device, "async_get_snapshot", None)
            if async_snapshot:
                try:
                    try:
                        # Ring first asks the doorbell/camera to generate a fresh
                        # snapshot, then polls its snapshot timestamp until the
                        # new image is ready. A battery device commonly needs
                        # several seconds to wake; the previous 1.5s window was
                        # much too short and caused valid cameras to return None.
                        snapshot = async_snapshot(retries=10, delay=1)
                    except TypeError:
                        snapshot = async_snapshot()
                    data = await asyncio.wait_for(snapshot, timeout=14)
                except TimeoutError as exc:
                    raise IntegrationError(
                        "Ring did not produce a fresh snapshot within 14 seconds. "
                        "The camera may still be waking up; wait a few seconds and try Refresh camera again."
                    ) from exc
                if isinstance(data, bytes) and data:
                    return data, "image/jpeg"
                raise IntegrationError(
                    "Ring accepted the snapshot request but did not publish a fresh image "
                    "within 10 seconds. Wait a few seconds and try Refresh camera again."
                )

            sync_snapshot = getattr(device, "get_snapshot", None)
            if sync_snapshot:
                try:
                    # Older python-ring-doorbell versions only expose the deprecated
                    # sync method. Calling it directly from this coroutine raises.
                    data = await asyncio.wait_for(
                        self.to_thread(sync_snapshot),
                        timeout=15,
                    )
                except TimeoutError as exc:
                    raise IntegrationError(
                        "Ring snapshot timed out. The camera may be waking up; try Refresh camera again."
                    ) from exc
                if isinstance(data, bytes):
                    return data, "image/jpeg"

            raise IntegrationError(
                "This installed Ring library does not expose a camera snapshot API."
            )
        finally:
            await close_ring_session(ring)
