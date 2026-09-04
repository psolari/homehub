from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.music.spotify import SpotifyService
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account


@register_driver
class GoogleCastDriver(BaseDriver):
    driver_key = "google_cast"
    device_type = "speaker"
    display_name = "Google Cast / Nest Speaker"
    manufacturer = "Google"
    config_schema = [
        {
            "name": "friendly_name",
            "label": "Cast name",
            "type": "string",
            "required": False,
            "description": "Usually filled automatically from discovery.",
        },
        {
            "name": "spotify_account_id",
            "label": "Spotify account",
            "type": "number",
            "required": False,
        },
        {
            "name": "spotify_device_id",
            "label": "Spotify Connect device ID",
            "type": "string",
            "required": False,
        },
        {
            "name": "spotify_device_name",
            "label": "Spotify Connect device name",
            "type": "string",
            "required": False,
        },
    ]
    setup_schema = {
        "description": "Connect to a Google Cast or Nest speaker discovered on your local network.",
        "requires_ip": True,
        "instructions": [
            "Keep the speaker powered on and connected to the same network as HomeHub.",
            "HomeHub will rediscover the Cast target and verify that it can read its playback state.",
            "Optionally link Spotify to enable Spotify search and Spotify Connect controls.",
        ],
        "optional_accounts": [
            {
                "provider": "spotify",
                "field": "spotify_account_id",
                "label": "Spotify account",
                "description": "Optional — enables Spotify playback from HomeHub.",
            }
        ],
        "test_connection": True,
        "advanced_fields": ["friendly_name", "spotify_device_id", "spotify_device_name"],
    }
    controls = [
        Control("play", "Play", group="playback"),
        Control("pause", "Pause", group="playback"),
        Control("stop", "Stop", group="playback"),
        Control("volume", "Volume", type="range", group="audio", state_key="volume", parameter="value", minimum=0, maximum=100, step=1, icon="volume"),
        Control("mute", "Mute", type="toggle", group="audio", state_key="muted", parameter="value", icon="volume-mute"),
        Control("play_uri", "Play URL", type="text", group="media", parameter="uri"),
        Control("spotify_play", "Play from Spotify", type="media_search", group="spotify", parameter="query"),
    ]

    def _cast(self):
        import pychromecast

        casts, browser = pychromecast.get_chromecasts(timeout=5)
        try:
            ip = str(self.device.ip_address or "")
            wanted = (self.config.get("friendly_name") or self.device.name).casefold()
            for cast in casts:
                info = cast.cast_info
                if (ip and str(getattr(info, "host", "")) == ip) or str(
                    getattr(info, "friendly_name", "")
                ).casefold() == wanted:
                    cast.wait(timeout=5)
                    return cast
            raise IntegrationError("Google Cast device was not found")
        finally:
            pychromecast.discovery.stop_discovery(browser)

    async def get_state(self):
        def read():
            cast = self._cast()
            status = cast.status
            media = cast.media_controller.status
            return {
                "online": True,
                "status": "on",
                "power": "on",
                "volume": round((status.volume_level or 0) * 100),
                "muted": bool(status.volume_muted),
                "playback": getattr(media, "player_state", None),
                "media": {
                    "title": getattr(media, "title", None),
                    "artist": getattr(media, "artist", None),
                },
            }

        return await self.to_thread(read)

    async def _media(self, name):
        cast = await self.to_thread(self._cast)
        return await self.to_thread(getattr(cast.media_controller, name))

    async def action_play(self):
        return await self._media("play")

    async def action_pause(self):
        return await self._media("pause")

    async def action_stop(self):
        return await self._media("stop")

    async def action_volume(self, value):
        cast = await self.to_thread(self._cast)
        value = max(0, min(100, int(value)))
        await self.to_thread(cast.set_volume, value / 100)
        return {"volume": value}

    async def action_mute(self, value=True):
        cast = await self.to_thread(self._cast)
        muted = bool(value)
        await self.to_thread(cast.set_volume_muted, muted)
        return {"muted": muted}

    async def action_unmute(self):
        return await self.action_mute(False)

    async def action_play_uri(self, uri, content_type="audio/mpeg"):
        cast = await self.to_thread(self._cast)
        await self.to_thread(cast.media_controller.play_media, uri, content_type)
        return {"uri": uri}

    async def action_spotify_play(self, query):
        service = SpotifyService(
            get_active_account("spotify", account_id=self.config.get("spotify_account_id"))
        )
        return await self.to_thread(
            service.play_search,
            query,
            self.config.get("spotify_device_id"),
            self.config.get("spotify_device_name") or self.device.name,
        )
