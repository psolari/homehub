from __future__ import annotations
from typing import Any
from django.utils import timezone

from homehub.core.models import IntegrationAccount
from homehub.core.services.accounts import get_credentials, set_credentials

SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing"


class SpotifyService:
    def __init__(self, account: IntegrationAccount):
        self.account = account
        self.credentials = get_credentials(account)
        from spotipy.oauth2 import SpotifyOAuth
        self.oauth = SpotifyOAuth(client_id=self.credentials["client_id"], client_secret=self.credentials["client_secret"], redirect_uri=self.credentials["redirect_uri"], scope=SCOPES, open_browser=False)

    def authorization_url(self, state: str) -> str:
        return self.oauth.get_authorize_url(state=state)

    def exchange_code(self, code: str) -> dict[str, Any]:
        token_info = self.oauth.get_access_token(code, as_dict=True, check_cache=False)
        set_credentials(self.account, {"token_info": token_info})
        self.account.status, self.account.error = "connected", ""
        self.account.metadata = {
            **(self.account.metadata or {}),
            "verified_at": timezone.now().isoformat(),
        }
        self.account.save(update_fields=["status", "error", "metadata"])
        return token_info

    def _token_info(self):
        credentials = get_credentials(self.account)
        token_info = credentials.get("token_info")
        if not token_info:
            raise RuntimeError("Spotify authorization has not been completed.")
        if self.oauth.is_token_expired(token_info):
            token_info = self.oauth.refresh_access_token(token_info["refresh_token"])
            set_credentials(self.account, {"token_info": token_info})
        return token_info

    def client(self):
        import spotipy
        return spotipy.Spotify(auth=self._token_info()["access_token"])

    def devices(self):
        return self.client().devices().get("devices", [])

    def resolve_device(self, *, device_id=None, device_name=None):
        if device_id: return device_id
        if not device_name: return None
        for item in self.devices():
            if str(item.get("name","")).casefold() == str(device_name).casefold(): return item.get("id")
        return None

    def search(self, query: str, limit: int = 10):
        result = self.client().search(q=query, type="track,album,playlist", limit=limit)
        items=[]
        for track in result.get("tracks",{}).get("items",[]): items.append({"type":"track","name":track["name"],"subtitle":", ".join(a["name"] for a in track["artists"]),"uri":track["uri"]})
        for album in result.get("albums",{}).get("items",[]): items.append({"type":"album","name":album["name"],"subtitle":", ".join(a["name"] for a in album["artists"]),"uri":album["uri"]})
        for playlist in result.get("playlists",{}).get("items",[]):
            if playlist: items.append({"type":"playlist","name":playlist["name"],"subtitle":(playlist.get("owner") or {}).get("display_name", ""),"uri":playlist["uri"]})
        return items

    def play(self, uri: str, *, device_id=None, device_name=None):
        target=self.resolve_device(device_id=device_id, device_name=device_name); kwargs={"device_id":target} if target else {}
        if uri.startswith("spotify:track:"): self.client().start_playback(uris=[uri], **kwargs)
        else: self.client().start_playback(context_uri=uri, **kwargs)

    def set_volume(self, value: int, *, device_id=None, device_name=None):
        self.client().volume(max(0,min(100,int(value))), device_id=self.resolve_device(device_id=device_id, device_name=device_name))

    def play_search(self, query: str, device_id=None, device_name=None):
        results=self.search(query,5)
        if not results: raise RuntimeError(f"No Spotify results found for '{query}'.")
        selected=results[0]; self.play(selected["uri"], device_id=device_id, device_name=device_name); return selected
