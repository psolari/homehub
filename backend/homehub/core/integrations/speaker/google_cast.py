from uuid import NAMESPACE_URL, UUID, uuid5

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
            "name": "cast_uuid",
            "label": "Cast UUID",
            "type": "string",
            "required": False,
            "description": "Usually filled automatically from discovery.",
        },
        {
            "name": "cast_model_name",
            "label": "Cast model",
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
            "HomeHub will connect directly to the saved Cast IP address and verify that it can read its playback state.",
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
        "advanced_fields": [
            "friendly_name",
            "cast_uuid",
            "cast_model_name",
            "spotify_device_id",
            "spotify_device_name",
        ],
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

    def _cast_uuid(self) -> UUID:
        configured = str(self.config.get("cast_uuid") or "").strip()
        if configured:
            try:
                return UUID(configured)
            except ValueError:
                pass

        identity = (
            f"homehub-google-cast:{self.device.ip_address}:"
            f"{self.config.get('friendly_name') or self.device.name}"
        )
        return uuid5(NAMESPACE_URL, identity)

    def _cast(self):
        """Open one short-lived direct connection to the saved Cast host.

        HomeHub used to discover the device with mDNS on every refresh, return a
        Chromecast object tied to that Zeroconf browser, and immediately stop the
        browser. The socket thread then tried to reconnect through a stopped
        Zeroconf event loop. Direct-host connections avoid that dependency.
        """
        import pychromecast

        ip = str(self.device.ip_address or "").strip()
        if not ip:
            raise IntegrationError("Google Cast device does not have an IP address")

        cast = pychromecast.get_chromecast_from_host(
            (
                ip,
                8009,
                self._cast_uuid(),
                str(self.config.get("cast_model_name") or "") or None,
                str(self.config.get("friendly_name") or self.device.name or "") or None,
            ),
            tries=2,
            retry_wait=0.75,
            timeout=5,
        )
        try:
            cast.wait(timeout=5)
            return cast
        except Exception:
            try:
                cast.disconnect(timeout=1)
            except Exception:
                pass
            raise

    def _with_cast(self, operation):
        cast = self._cast()
        try:
            return operation(cast)
        finally:
            # Every pychromecast connection owns a worker thread. Explicitly
            # disconnect it so dashboard polling cannot accumulate hundreds of
            # orphaned threads over time.
            try:
                cast.disconnect(timeout=2)
            except Exception:
                try:
                    cast.socket_client.disconnect()
                except Exception:
                    pass

    async def get_state(self):
        def read(cast):
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

        return await self.to_thread(self._with_cast, read)

    async def _media(self, name):
        def run(cast):
            return getattr(cast.media_controller, name)()

        return await self.to_thread(self._with_cast, run)

    async def action_play(self):
        return await self._media("play")

    async def action_pause(self):
        return await self._media("pause")

    async def action_stop(self):
        return await self._media("stop")

    async def action_volume(self, value):
        value = max(0, min(100, int(value)))

        def run(cast):
            cast.set_volume(value / 100)
            return {"volume": value}

        return await self.to_thread(self._with_cast, run)

    async def action_mute(self, value=True):
        muted = bool(value)

        def run(cast):
            cast.set_volume_muted(muted)
            return {"muted": muted}

        return await self.to_thread(self._with_cast, run)

    async def action_unmute(self):
        return await self.action_mute(False)

    async def action_play_uri(self, uri, content_type="audio/mpeg"):
        def run(cast):
            cast.media_controller.play_media(uri, content_type)
            return {"uri": uri}

        return await self.to_thread(self._with_cast, run)

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
