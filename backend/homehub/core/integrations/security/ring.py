from homehub.core.integrations.base import BaseDriver, Control, IntegrationError, TwoFactorRequired
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import (
    get_account_credentials,
    get_active_account,
    set_account_credentials,
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
        Control("lights_on", "Lights on", group="security"),
        Control("lights_off", "Lights off", group="security"),
        Control("siren_on", "Siren on", group="security"),
        Control("siren_off", "Siren off", group="security"),
        Control("snapshot", "Refresh camera", group="camera"),
    ]

    async def _ring(self):
        from ring_doorbell import Auth, Ring
        from ring_doorbell.exceptions import Requires2FAError

        account = get_active_account("ring", account_id=self.config.get("account_id"))
        credentials = get_account_credentials(account)

        def token_updated(token):
            credentials["token"] = token
            set_account_credentials(account, credentials)

        auth = Auth("HomeHub/1.0", credentials.get("token"), token_updated)
        try:
            if not credentials.get("token"):
                await auth.async_fetch_token(
                    credentials.get("username", ""),
                    credentials.get("password", ""),
                    credentials.get("otp"),
                )
        except Requires2FAError as exc:
            raise TwoFactorRequired("Ring requires a one-time authentication code") from exc
        ring = Ring(auth)
        if hasattr(ring, "async_create_session"):
            await ring.async_create_session()
        if hasattr(ring, "async_update_data"):
            await ring.async_update_data()
        return ring

    async def _device(self):
        ring = await self._ring()
        devices = ring.devices()
        devices = await devices if hasattr(devices, "__await__") else devices
        wanted = str(self.config.get("ring_device_id"))
        for family, values in (devices.items() if isinstance(devices, dict) else []):
            for device in values or []:
                identity = str(
                    getattr(device, "device_id", getattr(device, "id", getattr(device, "account_id", "")))
                )
                if identity == wanted or str(getattr(device, "name", "")) == wanted:
                    return device, family
        raise IntegrationError("Ring device was not found")

    @staticmethod
    def _attr(obj, name, default=None):
        value = getattr(obj, name, default)
        try:
            return value() if callable(value) else value
        except Exception:
            return default

    async def get_state(self):
        device, family = await self._device()
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

    async def _set(self, names, value=None):
        device, _ = await self._device()
        for name in names:
            function = getattr(device, name, None)
            if function:
                result = function() if value is None else function(value)
                return await result if hasattr(result, "__await__") else result
        raise IntegrationError(f"Ring operation is not available: {names[0]}")

    async def action_lights_on(self):
        return await self._set(("async_set_lights", "set_lights"), True)

    async def action_lights_off(self):
        return await self._set(("async_set_lights", "set_lights"), False)

    async def action_siren_on(self):
        return await self._set(("async_set_siren", "set_siren"), True)

    async def action_siren_off(self):
        return await self._set(("async_set_siren", "set_siren"), False)

    async def action_snapshot(self):
        return {"available": (await self.camera_frame()) is not None}

    async def camera_frame(self):
        device, _ = await self._device()
        for name in ("async_get_snapshot", "get_snapshot"):
            function = getattr(device, name, None)
            if function:
                data = function()
                data = await data if hasattr(data, "__await__") else data
                if isinstance(data, bytes):
                    return data, "image/jpeg"
        return None
