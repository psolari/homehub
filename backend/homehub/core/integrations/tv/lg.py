from __future__ import annotations

import dataclasses

from wakeonlan import send_magic_packet

from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver


@register_driver
class LGWebOSDriver(BaseDriver):
    driver_key = "lg_webos"
    device_type = "tv"
    display_name = "LG webOS TV"
    manufacturer = "LG"
    config_schema = [
        {
            "name": "client_key",
            "label": "Pairing key",
            "type": "password",
            "secret": True,
            "required": False,
            "description": "Normally created automatically after you approve HomeHub on the TV.",
        },
        {
            "name": "mac_address",
            "label": "MAC address",
            "type": "string",
            "required": False,
            "description": "Recommended so HomeHub can wake the TV with Wake-on-LAN.",
        },
    ]
    setup_schema = {
        "description": "Pair HomeHub with an LG webOS television on the local network.",
        "requires_ip": True,
        "requires_mac": False,
        "instructions": [
            "Turn the TV on and make sure it is connected to the same network as HomeHub.",
            "Leave Pairing key blank for a first-time setup. During the connection test, accept the HomeHub pairing request shown on the TV.",
            "Add the TV's MAC address if you want HomeHub to power it on while it is asleep.",
        ],
        "test_connection": True,
        "advanced_fields": ["client_key"],
    }
    controls = [
        Control("power_on", "Power on"),
        Control("power_off", "Power off"),
        Control("volume_up", "Volume +"),
        Control("volume_down", "Volume -"),
        Control("set_volume", "Volume", type="range", parameter="value", minimum=0, maximum=100, step=1),
        Control("set_mute", "Mute", type="toggle", parameter="value"),
        Control("play", "Play", group="media"),
        Control("pause", "Pause", group="media"),
        Control("stop", "Stop", group="media"),
        Control("set_input", "Input", type="select", group="media", parameter="value", options_from_state="inputs"),
        Control("launch_app", "App", type="select", group="media", parameter="value", options_from_state="apps"),
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
            raise IntegrationError("LG webOS devices require an IP address.")
        return str(self.device.ip_address)

    async def _client(self):
        from aiowebostv import WebOsClient

        key = self.config.get("client_key")
        client = WebOsClient(self._host(), key or None)
        await client.connect()
        if client.client_key and client.client_key != key:
            from homehub.core.services.device_config import set_device_credentials

            set_device_credentials(self.device, {"client_key": client.client_key})
            self.config["client_key"] = client.client_key
        return client

    def _state(self, client):
        state = client.tv_state
        return {
            "online": True,
            "status": "on" if state.is_on else "off",
            "power": bool(state.is_on),
            "volume": state.volume,
            "muted": state.muted,
            "current_app": state.current_app_id,
            "inputs": [
                {"value": key, "label": value.get("label", key)}
                for key, value in (state.inputs or {}).items()
            ],
            "apps": [
                {"value": key, "label": value.get("title", key)}
                for key, value in (state.apps or {}).items()
            ],
            "details": dataclasses.asdict(state),
        }

    async def get_state(self):
        try:
            client = await self._client()
            try:
                return self._state(client)
            finally:
                await client.disconnect()
        except Exception as exc:
            return {"online": False, "status": "off", "power": False, "error": str(exc)}

    async def initialize(self):
        client = await self._client()
        try:
            state = self._state(client)
            if not state.get("online"):
                raise IntegrationError("LG TV did not complete pairing.")
            return state
        finally:
            await client.disconnect()

    async def _call(self, name, *args):
        client = await self._client()
        try:
            return await getattr(client, name)(*args)
        finally:
            await client.disconnect()

    async def _button(self, key):
        return await self._call("button", key)

    async def action_power_on(self):
        mac = self.device.mac_address or self.config.get("mac_address")
        if mac:
            await self.to_thread(send_magic_packet, mac)
            return {"sent": True}
        return await self._call("power_on")

    async def action_power_off(self):
        return await self._call("power_off")

    async def action_volume_up(self):
        return await self._call("volume_up")

    async def action_volume_down(self):
        return await self._call("volume_down")

    async def action_set_volume(self, value):
        return await self._call("set_volume", int(value))

    async def action_set_mute(self, value):
        return await self._call("set_mute", bool(value))

    async def action_play(self):
        return await self._button("PLAY")

    async def action_pause(self):
        return await self._button("PAUSE")

    async def action_stop(self):
        return await self._button("STOP")

    async def action_set_input(self, value):
        return await self._call("set_input", value)

    async def action_launch_app(self, value):
        return await self._call("launch_app", value)

    async def action_home(self):
        return await self._button("HOME")

    async def action_back(self):
        return await self._button("BACK")

    async def action_up(self):
        return await self._button("UP")

    async def action_down(self):
        return await self._button("DOWN")

    async def action_left(self):
        return await self._button("LEFT")

    async def action_right(self):
        return await self._button("RIGHT")

    async def action_enter(self):
        return await self._button("ENTER")

    async def action_channel_up(self):
        return await self._button("CHANNELUP")

    async def action_channel_down(self):
        return await self._button("CHANNELDOWN")

    async def action_remote_key(self, value):
        return await self._button(str(value).upper())
