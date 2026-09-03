from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.music.spotify import SpotifyService
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account, get_account_credentials


@register_driver
class AlexaDriver(BaseDriver):
    driver_key = "alexa_echo"
    device_type = "speaker"
    display_name = "Amazon Alexa / Echo"
    manufacturer = "Amazon"
    config_schema = [
        {"name":"account_id","label":"Alexa account ID","type":"number","required":True},
        {"name":"serial_number","label":"Alexa device serial","type":"string","required":True},
        {"name":"spotify_account_id","label":"Spotify account ID","type":"number","required":False},
        {"name":"spotify_device_id","label":"Spotify Connect device ID","type":"string","required":False},
        {"name":"spotify_device_name","label":"Spotify Connect device name","type":"string","required":False},
    ]
    controls = [
        Control("play","Play",group="playback"), Control("pause","Pause",group="playback"),
        Control("next","Next",group="playback"), Control("previous","Previous",group="playback"),
        Control("volume","Volume",type="range",group="audio",parameter="value",minimum=0,maximum=100,step=1),
        Control("announcement","Announcement",type="text",group="voice",parameter="text"),
        Control("tts","Speak",type="text",group="voice",parameter="text"),
        Control("custom","Alexa command",type="text",group="voice",parameter="text"),
        Control("spotify_play","Play from Spotify",type="media_search",group="spotify",parameter="query"),
        Control("spotify_volume","Spotify volume",type="range",group="spotify",parameter="value",minimum=0,maximum=100,step=1),
    ]

    async def _api(self):
        from alexapy import AlexaAPI, AlexaLogin

        account = get_active_account("alexa", account_id=self.config.get("account_id"))
        credentials = get_account_credentials(account)
        login = AlexaLogin(
            url=credentials.get("url", "amazon.co.uk"),
            email=credentials.get("email", ""),
            password=credentials.get("password", ""),
            outputpath=None,
            otp_secret=credentials.get("otp_secret"),
        )
        await login.login(cookies=credentials.get("cookies"))
        devices = await AlexaAPI.get_devices(login)
        serial = self.config.get("serial_number")
        device = next(
            (item for item in devices if item.get("serialNumber") == serial or item.get("serial_number") == serial),
            None,
        )
        if not device:
            raise IntegrationError("Alexa device is not available on the configured account")
        return AlexaAPI(device, login), device

    async def get_state(self):
        _, device = await self._api()
        online = device.get("online", True)
        return {
            "online": online,
            "status": "on" if online else "unknown",
            "power": "on" if online else "off",
            "name": device.get("accountName") or device.get("name"),
            "serial_number": device.get("serialNumber") or device.get("serial_number"),
        }

    async def _call(self, method, *args):
        api, _ = await self._api()
        function = getattr(api, method, None)
        if not function:
            raise IntegrationError(f"Alexa operation {method} is unavailable")
        result = function(*args)
        return await result if hasattr(result, "__await__") else result

    async def action_play(self): return await self._call("play")
    async def action_pause(self): return await self._call("pause")
    async def action_next(self): return await self._call("next")
    async def action_previous(self): return await self._call("previous")
    async def action_volume(self, value): return await self._call("set_volume", max(0, min(100, int(value))) / 100)
    async def action_announcement(self, text): return await self._call("send_announcement", text)
    async def action_tts(self, text): return await self._call("send_tts", text)
    async def action_custom(self, text): return await self._call("run_custom", text)

    def _spotify(self):
        return SpotifyService(get_active_account("spotify", account_id=self.config.get("spotify_account_id")))

    async def action_spotify_play(self, query):
        return await self.to_thread(
            self._spotify().play_search,
            query,
            self.config.get("spotify_device_id"),
            self.config.get("spotify_device_name") or self.device.name,
        )

    async def action_spotify_volume(self, value):
        return await self.to_thread(
            self._spotify().set_volume,
            int(value),
            device_id=self.config.get("spotify_device_id"),
            device_name=self.config.get("spotify_device_name") or self.device.name,
        )
