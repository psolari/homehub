from pathlib import Path

from django.conf import settings
from samsungtvws import SamsungTVWS
from wakeonlan import send_magic_packet

from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver


@register_driver
class SamsungTizenDriver(BaseDriver):
    driver_key = "samsung_tizen"
    device_type = "tv"
    display_name = "Samsung Tizen TV"
    manufacturer = "Samsung"
    config_schema = [
        {
            "name": "token",
            "label": "Pairing token",
            "type": "password",
            "secret": True,
            "required": False,
            "description": "Normally generated automatically after approving HomeHub on the television.",
        },
        {
            "name": "mac_address",
            "label": "MAC address",
            "type": "string",
            "required": False,
            "description": "Required if you want HomeHub to wake the television from standby.",
        },
        {
            "name": "port",
            "label": "WebSocket port",
            "type": "number",
            "default": 8002,
            "description": "Modern Tizen televisions normally use secure WebSocket port 8002.",
        },
    ]
    setup_schema = {
        "description": "Pair HomeHub with a Samsung Tizen television and save its network token securely.",
        "requires_ip": True,
        "requires_mac": False,
        "instructions": [
            "Turn the television on and make sure it is connected to the same network as HomeHub.",
            "Leave Pairing token blank for a first-time setup. HomeHub will open the Samsung remote-control WebSocket during the connection test.",
            "When the television asks whether HomeHub may control it, choose Allow. The returned token is stored encrypted by HomeHub.",
            "Add the television MAC address if you want the Power on control to work from standby.",
        ],
        "test_connection": True,
        "advanced_fields": ["token", "port"],
    }
    controls = [
        Control("power_on", "Power on"),
        Control("power_off", "Power off"),
        Control("volume_up", "Volume +"),
        Control("volume_down", "Volume -"),
        Control("mute", "Mute"),
        Control("play", "Play", group="media"),
        Control("pause", "Pause", group="media"),
        Control("stop", "Stop", group="media"),
        Control("source", "Source", group="media"),
        Control("launch_app", "Launch app", type="text", group="media", parameter="value"),
        *[
            Control(action, label, group="remote")
            for action, label in [
                ("home", "Home"),
                ("back", "Back"),
                ("up", "Up"),
                ("down", "Down"),
                ("left", "Left"),
                ("right", "Right"),
                ("enter", "OK"),
                ("channel_up", "Channel +"),
                ("channel_down", "Channel -"),
            ]
        ],
        Control("remote_key", "Remote key", type="text", group="remote", parameter="value"),
    ]

    def _host(self):
        if not self.device.ip_address:
            raise IntegrationError("Samsung TVs require an IP address")
        return str(self.device.ip_address)

    def _token_path(self):
        path = Path(settings.HOMEHUB_RUNTIME_DIR) / "samsung_tokens"
        path.mkdir(parents=True, exist_ok=True)
        return path / f"device-{self.device.pk}.token"

    def _remote(self):
        path = self._token_path()
        token = self.config.get("token")
        if token and not path.exists():
            path.write_text(str(token))
        return SamsungTVWS(
            host=self._host(),
            port=int(self.config.get("port", 8002)),
            token_file=str(path),
            timeout=8,
            name="HomeHub",
        )

    def _persist_token(self):
        path = self._token_path()
        if path.exists():
            token = path.read_text().strip()
            if token and token != self.config.get("token"):
                from homehub.core.services.device_config import set_device_credentials

                set_device_credentials(self.device, {"token": token})
                self.config["token"] = token

    async def initialize(self):
        # Opening the remote-control WebSocket is the pairing operation. It is
        # deliberately done before the passive REST state check so first-time
        # setup prompts appear on the TV and the token can be persisted.
        remote = self._remote()
        try:
            await self.to_thread(remote.open)
        finally:
            try:
                await self.to_thread(remote.close)
            except Exception:
                pass
        self._persist_token()
        state = await self.get_state()
        if not state.get("online"):
            raise IntegrationError(state.get("error") or "Samsung TV did not complete pairing")
        return state

    async def get_state(self):
        try:
            info = await self.to_thread(self._remote().rest_device_info)
            self._persist_token()
            return {"online": True, "status": "on", "power": True, "device_info": info}
        except Exception as exc:
            return {"online": False, "status": "off", "power": False, "error": str(exc)}

    async def _key(self, key):
        remote = self._remote()
        result = await self.to_thread(remote.send_key, key)
        self._persist_token()
        return result

    async def _shortcut(self, name):
        remote = self._remote()
        result = await self.to_thread(getattr(remote.shortcuts(), name))
        self._persist_token()
        return result

    async def action_power_on(self):
        mac = self.device.mac_address or self.config.get("mac_address")
        if not mac:
            raise IntegrationError("A MAC address is required to power on a Samsung TV")
        await self.to_thread(send_magic_packet, mac)
        return {"sent": True}

    async def action_power_off(self):
        return await self._key("KEY_POWER")

    async def action_volume_up(self):
        return await self._shortcut("volume_up")

    async def action_volume_down(self):
        return await self._shortcut("volume_down")

    async def action_mute(self):
        return await self._shortcut("mute")

    async def action_play(self):
        return await self._key("KEY_PLAY")

    async def action_pause(self):
        return await self._key("KEY_PAUSE")

    async def action_stop(self):
        return await self._key("KEY_STOP")

    async def action_source(self):
        return await self._shortcut("source")

    async def action_launch_app(self, value):
        remote = self._remote()
        result = await self.to_thread(remote.rest_app_run, value)
        self._persist_token()
        return result

    async def action_home(self):
        return await self._shortcut("home")

    async def action_back(self):
        return await self._shortcut("back")

    async def action_up(self):
        return await self._shortcut("up")

    async def action_down(self):
        return await self._shortcut("down")

    async def action_left(self):
        return await self._shortcut("left")

    async def action_right(self):
        return await self._shortcut("right")

    async def action_enter(self):
        return await self._shortcut("enter")

    async def action_channel_up(self):
        return await self._shortcut("channel_up")

    async def action_channel_down(self):
        return await self._shortcut("channel_down")

    async def action_remote_key(self, value):
        key = str(value).upper()
        return await self._key(key if key.startswith("KEY_") else f"KEY_{key}")
