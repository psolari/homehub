from __future__ import annotations

from typing import Any

from django.utils import timezone

from homehub.core.models import IntegrationAccount
from homehub.core.services.accounts import get_credentials, set_credentials

SCOPES = " ".join(
    [
        "playlist-read-private",
        "playlist-read-collaborative",
        "user-library-read",
        "user-top-read",
        "user-read-recently-played",
        "user-read-playback-state",
        "user-modify-playback-state",
        "user-read-currently-playing",
        "user-read-private",
    ]
)


def _image(item: dict[str, Any] | None) -> str | None:
    if not item:
        return None
    images = item.get("images") or []
    return images[0].get("url") if images else None


def _artists(item: dict[str, Any] | None) -> str:
    if not item:
        return ""
    return ", ".join(
        artist.get("name", "")
        for artist in item.get("artists") or []
        if artist.get("name")
    )


def _media_item(item: dict[str, Any], *, item_type: str | None = None) -> dict[str, Any]:
    kind = item_type or item.get("type") or "track"
    album = item.get("album") or {}
    show = item.get("show") or {}
    owner = item.get("owner") or {}
    subtitle = ""
    if kind in {"track", "album"}:
        subtitle = _artists(item) or _artists(album)
    elif kind in {"episode", "show"}:
        subtitle = (show or item).get("publisher", "")
    elif kind == "playlist":
        subtitle = owner.get("display_name") or owner.get("id") or ""

    return {
        "id": item.get("id"),
        "uri": item.get("uri"),
        "type": kind,
        "name": item.get("name") or item.get("title") or "Untitled",
        "subtitle": subtitle,
        "image": _image(item) or _image(album) or _image(show),
        "duration_ms": item.get("duration_ms"),
        "explicit": bool(item.get("explicit", False)),
        "description": item.get("description") or "",
        "external_url": (item.get("external_urls") or {}).get("spotify"),
    }


class SpotifyService:
    def __init__(self, account: IntegrationAccount):
        self.account = account
        self.credentials = get_credentials(account)
        from spotipy.oauth2 import SpotifyOAuth

        self.oauth = SpotifyOAuth(
            client_id=self.credentials["client_id"],
            client_secret=self.credentials["client_secret"],
            redirect_uri=self.credentials["redirect_uri"],
            scope=SCOPES,
            open_browser=False,
        )

    @property
    def required_scopes(self) -> set[str]:
        return set(SCOPES.split())

    def authorization_url(self, state: str) -> str:
        return self.oauth.get_authorize_url(state=state)

    def exchange_code(self, code: str) -> dict[str, Any]:
        token_info = self.oauth.get_access_token(
            code,
            as_dict=True,
            check_cache=False,
        )
        set_credentials(self.account, {"token_info": token_info})
        self.account.status, self.account.error = "connected", ""
        self.account.metadata = {
            **(self.account.metadata or {}),
            "verified_at": timezone.now().isoformat(),
            "spotify_scopes": sorted(self.token_scopes(token_info)),
        }
        self.account.save(update_fields=["status", "error", "metadata"])
        return token_info

    def token_scopes(self, token_info: dict[str, Any] | None = None) -> set[str]:
        info = token_info or get_credentials(self.account).get("token_info") or {}
        scope = info.get("scope") or ""
        if isinstance(scope, str):
            return set(scope.split())
        return set(scope or [])

    def missing_scopes(self) -> list[str]:
        return sorted(self.required_scopes - self.token_scopes())

    def _token_info(self):
        credentials = get_credentials(self.account)
        token_info = credentials.get("token_info")
        if not token_info:
            raise RuntimeError("Spotify authorization has not been completed.")
        if self.oauth.is_token_expired(token_info):
            refresh_token = token_info.get("refresh_token")
            if not refresh_token:
                raise RuntimeError("Spotify authorization expired. Reconnect Spotify.")
            token_info = self.oauth.refresh_access_token(refresh_token)
            set_credentials(self.account, {"token_info": token_info})
        return token_info

    def client(self):
        import spotipy

        return spotipy.Spotify(auth=self._token_info()["access_token"])

    def profile(self) -> dict[str, Any]:
        profile = self.client().current_user() or {}
        return {
            "display_name": profile.get("display_name") or "Spotify",
            "image": _image(profile),
            "product": profile.get("product"),
            "country": profile.get("country"),
        }

    def devices(self):
        return self.client().devices().get("devices", [])

    def resolve_device(self, *, device_id=None, device_name=None):
        if device_id:
            return device_id
        if not device_name:
            return None
        wanted = str(device_name).casefold().strip()
        for item in self.devices():
            if str(item.get("name", "")).casefold().strip() == wanted:
                return item.get("id")
        return None

    def _all_pages(self, getter, *, page_size=50, max_items=200):
        items: list[dict[str, Any]] = []
        offset = 0
        while len(items) < max_items:
            page = getter(limit=page_size, offset=offset) or {}
            batch = page.get("items") or []
            items.extend(batch)
            if not page.get("next") or not batch:
                break
            offset += len(batch)
        return items[:max_items]

    def playlists(self) -> list[dict[str, Any]]:
        items = self._all_pages(self.client().current_user_playlists)
        return [_media_item(item, item_type="playlist") for item in items if item]

    def radio_and_mixes(self, playlists: list[dict[str, Any]] | None = None):
        items = playlists if playlists is not None else self.playlists()
        terms = (
            "mix",
            "radio",
            "daylist",
            "discover weekly",
            "release radar",
            "on repeat",
            "repeat rewind",
        )
        return [
            item
            for item in items
            if any(term in str(item.get("name", "")).casefold() for term in terms)
        ]

    def saved_shows(self) -> list[dict[str, Any]]:
        raw = self._all_pages(self.client().current_user_saved_shows)
        return [
            _media_item(item.get("show") or {}, item_type="show")
            for item in raw
            if item.get("show")
        ]

    def saved_episodes(self) -> list[dict[str, Any]]:
        raw = self._all_pages(
            self.client().current_user_saved_episodes,
            max_items=100,
        )
        return [
            _media_item(item.get("episode") or {}, item_type="episode")
            for item in raw
            if item.get("episode")
        ]

    def top_tracks(self) -> list[dict[str, Any]]:
        result = self.client().current_user_top_tracks(
            limit=20,
            time_range="medium_term",
        )
        return [
            _media_item(item, item_type="track")
            for item in result.get("items", [])
            if item
        ]

    def recently_played(self) -> list[dict[str, Any]]:
        result = self.client().current_user_recently_played(limit=20)
        return [
            _media_item(item.get("track") or {}, item_type="track")
            for item in result.get("items", [])
            if item.get("track")
        ]

    def show_episodes(self, show_id: str) -> list[dict[str, Any]]:
        result = self.client().show_episodes(show_id, limit=50)
        return [
            _media_item(item, item_type="episode")
            for item in result.get("items", [])
            if item
        ]

    def search_grouped(self, query: str, limit: int = 8) -> dict[str, list[dict[str, Any]]]:
        if not query.strip():
            return {
                "tracks": [],
                "albums": [],
                "artists": [],
                "playlists": [],
                "shows": [],
                "episodes": [],
            }
        result = self.client().search(
            q=query.strip(),
            type="track,album,artist,playlist,show,episode",
            limit=max(1, min(10, limit)),
        )
        mapping = {
            "tracks": ("tracks", "track"),
            "albums": ("albums", "album"),
            "artists": ("artists", "artist"),
            "playlists": ("playlists", "playlist"),
            "shows": ("shows", "show"),
            "episodes": ("episodes", "episode"),
        }
        return {
            key: [
                _media_item(item, item_type=item_type)
                for item in (result.get(bucket) or {}).get("items", [])
                if item
            ]
            for key, (bucket, item_type) in mapping.items()
        }

    def playback(self) -> dict[str, Any]:
        playback = self.client().current_playback(
            additional_types="track,episode",
        )
        if not playback:
            return {
                "is_playing": False,
                "item": None,
                "device": None,
                "progress_ms": 0,
                "shuffle_state": False,
                "repeat_state": "off",
            }
        item = playback.get("item")
        device = playback.get("device")
        return {
            "is_playing": bool(playback.get("is_playing")),
            "item": _media_item(item) if item else None,
            "device": {
                "id": device.get("id"),
                "name": device.get("name"),
                "type": device.get("type"),
                "volume_percent": device.get("volume_percent"),
                "supports_volume": device.get("supports_volume"),
                "is_restricted": device.get("is_restricted"),
            }
            if device
            else None,
            "progress_ms": playback.get("progress_ms") or 0,
            "shuffle_state": bool(playback.get("shuffle_state")),
            "repeat_state": playback.get("repeat_state") or "off",
            "context": playback.get("context"),
        }

    def queue(self) -> list[dict[str, Any]]:
        client = self.client()
        if not hasattr(client, "queue"):
            return []
        result = client.queue() or {}
        return [
            _media_item(item)
            for item in result.get("queue", [])[:20]
            if item
        ]

    def home(self) -> dict[str, Any]:
        playlists = self.playlists()
        return {
            "profile": self.profile(),
            "playlists": playlists,
            "radio_and_mixes": self.radio_and_mixes(playlists),
            "shows": self.saved_shows(),
            "episodes": self.saved_episodes(),
            "top_tracks": self.top_tracks(),
            "recently_played": self.recently_played(),
            "playback": self.playback(),
            "queue": self.queue(),
            "spotify_devices": self.devices(),
            "missing_scopes": self.missing_scopes(),
        }

    def play(self, uri: str | None = None, *, device_id=None, device_name=None):
        target = self.resolve_device(device_id=device_id, device_name=device_name)
        kwargs = {"device_id": target} if target else {}
        if not uri:
            self.client().start_playback(**kwargs)
            return
        if uri.startswith(("spotify:track:", "spotify:episode:")):
            self.client().start_playback(uris=[uri], **kwargs)
        elif uri.startswith(("spotify:playlist:", "spotify:album:", "spotify:artist:")):
            self.client().start_playback(context_uri=uri, **kwargs)
        else:
            raise RuntimeError(f"Spotify item cannot be played as a context: {uri}")

    def pause(self, *, device_id=None):
        self.client().pause_playback(device_id=device_id)

    def next(self, *, device_id=None):
        self.client().next_track(device_id=device_id)

    def previous(self, *, device_id=None):
        self.client().previous_track(device_id=device_id)

    def set_shuffle(self, value: bool, *, device_id=None):
        self.client().shuffle(bool(value), device_id=device_id)

    def set_repeat(self, value: str, *, device_id=None):
        if value not in {"off", "track", "context"}:
            raise RuntimeError("Spotify repeat must be off, track or context.")
        self.client().repeat(value, device_id=device_id)

    def seek(self, position_ms: int, *, device_id=None):
        self.client().seek_track(max(0, int(position_ms)), device_id=device_id)

    def add_to_queue(self, uri: str, *, device_id=None):
        self.client().add_to_queue(uri, device_id=device_id)

    def transfer(self, device_id: str, *, play: bool = True):
        self.client().transfer_playback(device_id, force_play=bool(play))

    def set_volume(self, value: int, *, device_id=None, device_name=None):
        self.client().volume(
            max(0, min(100, int(value))),
            device_id=self.resolve_device(
                device_id=device_id,
                device_name=device_name,
            ),
        )

    def play_search(self, query: str, device_id=None, device_name=None):
        results = self.search_grouped(query, limit=5)["tracks"]
        if not results:
            raise RuntimeError(f"No Spotify results found for '{query}'.")
        selected = results[0]
        self.play(
            selected["uri"],
            device_id=device_id,
            device_name=device_name,
        )
        return selected
