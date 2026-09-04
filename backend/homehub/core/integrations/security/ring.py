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
    take_ring_snapshot,
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
    snapshot_control = Control(
        "snapshot",
        "Refresh camera",
        group="camera",
        icon="camera",
    )
    lights_control = Control(
        "lights",
        "Lights",
        type="toggle",
        group="security",
        state_key="lights",
        parameter="value",
        icon="light",
    )
    siren_control = Control(
        "siren",
        "Siren",
        type="toggle",
        group="security",
        state_key="siren",
        parameter="value",
        icon="siren",
    )

    # Snapshot is the only universal Ring camera/doorbell control. Lights and
    # siren are hardware capabilities on some cameras (for example selected
    # Spotlight/Floodlight models), not generic Ring controls.
    controls = [snapshot_control]

    def capabilities(self) -> dict:
        discovery = self.device.discovery_data or {}
        state = self.device.state or {}
        family = str(
            self.config.get("family")
            or discovery.get("family")
            or state.get("family")
            or ""
        )

        advertised = discovery.get("ring_capabilities")
        advertised_set = {
            str(value).casefold()
            for value in advertised
        } if isinstance(advertised, list) else set()

        supports_lights = (
            state.get("supports_lights") is True
            or "light" in advertised_set
        )
        supports_siren = (
            state.get("supports_siren") is True
            or "siren" in advertised_set
        )

        # Doorbells do not expose the generic camera light/siren controls in
        # python-ring-doorbell. Be explicitly conservative for existing
        # configured devices created before capability metadata was persisted.
        if family in {"doorbots", "authorized_doorbots", "doorbells"}:
            supports_lights = False
            supports_siren = False

        controls = [self.snapshot_control]
        if supports_lights:
            controls.append(self.lights_control)
        if supports_siren:
            controls.append(self.siren_control)

        return {
            "driver": self.driver_key,
            "device_type": self.device_type,
            "controls": [control.as_dict() for control in controls],
        }

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
            capability = getattr(device, "has_capability", None)

            def supports(name: str) -> bool:
                if not capability:
                    return False
                try:
                    return bool(capability(name))
                except Exception:
                    return False

            supports_lights = supports("light")
            supports_siren = supports("siren")
            supports_video = supports("video") or family in {
                "doorbells",
                "doorbots",
                "authorized_doorbots",
                "stickup_cams",
                "cameras",
            }

            state = {
                "online": True,
                "status": "on",
                "power": "on",
                "family": family,
                "battery": self._attr(device, "battery_life"),
                "wifi_signal": self._attr(device, "wifi_signal_strength"),
                "camera_available": supports_video,
                "supports_lights": supports_lights,
                "supports_siren": supports_siren,
            }
            if supports_lights:
                state["lights"] = self._attr(device, "lights")
            if supports_siren:
                state["siren"] = self._attr(device, "siren")
            return state
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
            data = await take_ring_snapshot(
                ring,
                device,
                max_age=30,
                max_wait=12,
            )
            return data, "image/jpeg"
        except Exception as exc:
            if isinstance(exc, IntegrationError):
                raise
            raise IntegrationError(str(exc) or exc.__class__.__name__) from exc
        finally:
            await close_ring_session(ring)

