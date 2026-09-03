from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.music.spotify import SpotifyService
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account


@register_driver
class SonosDriver(BaseDriver):
    driver_key="sonos"; device_type="speaker"; display_name="Sonos Speaker"; manufacturer="Sonos"
    config_schema=[{"name":"spotify_account_id","label":"Spotify account ID","type":"number","required":False},{"name":"spotify_device_id","label":"Spotify Connect device ID","type":"string","required":False},{"name":"spotify_device_name","label":"Spotify Connect device name","type":"string","required":False}]
    controls=[Control("play","Play",group="playback"),Control("pause","Pause",group="playback"),Control("next","Next",group="playback"),Control("previous","Previous",group="playback"),Control("volume","Volume",type="range",group="audio",parameter="value",minimum=0,maximum=100,step=1),Control("mute","Mute",group="audio"),Control("unmute","Unmute",group="audio"),Control("source","Input",type="select",group="audio",parameter="value",options=[{"value":"queue","label":"Queue / streaming"},{"value":"line_in","label":"Line-in"},{"value":"tv","label":"TV"}]),Control("play_uri","Play URL",type="text",group="media",parameter="uri"),Control("spotify_play","Play from Spotify",type="media_search",group="spotify",parameter="query")]
    def _speaker(self):
        if not self.device.ip_address: raise IntegrationError("Sonos device requires an IP address")
        import soco
        return soco.SoCo(str(self.device.ip_address))
    async def get_state(self):
        def read():
            s=self._speaker(); transport=s.get_current_transport_info() or {}; track=s.get_current_track_info() or {}; state=transport.get("current_transport_state","UNKNOWN")
            return {"online":True,"status":"on" if state!="STOPPED" else "idle","power":"on","playback":state.lower(),"volume":s.volume,"muted":s.mute,"media":{"title":track.get("title"),"artist":track.get("artist"),"album":track.get("album"),"uri":track.get("uri")}}
        return await self.to_thread(read)
    async def action_play(self): return await self.to_thread(self._speaker().play)
    async def action_pause(self): return await self.to_thread(self._speaker().pause)
    async def action_next(self): return await self.to_thread(self._speaker().next)
    async def action_previous(self): return await self.to_thread(self._speaker().previous)
    async def action_volume(self,value):
        s=self._speaker(); value=max(0,min(100,int(value))); await self.to_thread(setattr,s,"volume",value); return {"volume":value}
    async def action_mute(self): s=self._speaker(); await self.to_thread(setattr,s,"mute",True); return {"muted":True}
    async def action_unmute(self): s=self._speaker(); await self.to_thread(setattr,s,"mute",False); return {"muted":False}
    async def action_play_uri(self,uri): return await self.to_thread(self._speaker().play_uri,uri)
    async def action_source(self,value):
        s=self._speaker()
        if value=="line_in": return await self.to_thread(s.switch_to_line_in)
        if value=="tv": return await self.to_thread(s.switch_to_tv)
        if value=="queue": return await self.to_thread(s.play_from_queue,0)
        raise IntegrationError(f"Unsupported Sonos input: {value}")
    async def action_spotify_play(self,query):
        account=get_active_account("spotify",account_id=self.config.get("spotify_account_id")); service=SpotifyService(account)
        return await self.to_thread(service.play_search,query,self.config.get("spotify_device_id"),self.config.get("spotify_device_name") or self.device.name)
