from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.music.spotify import SpotifyService
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account


@register_driver
class GoogleCastDriver(BaseDriver):
    driver_key="google_cast"; device_type="speaker"; display_name="Google Cast / Nest Speaker"; manufacturer="Google"
    config_schema=[{"name":"friendly_name","label":"Cast name","type":"string","required":False},{"name":"spotify_account_id","label":"Spotify account ID","type":"number","required":False},{"name":"spotify_device_id","label":"Spotify Connect device ID","type":"string","required":False},{"name":"spotify_device_name","label":"Spotify Connect device name","type":"string","required":False}]
    controls=[Control("play","Play",group="playback"),Control("pause","Pause",group="playback"),Control("stop","Stop",group="playback"),Control("volume","Volume",type="range",group="audio",parameter="value",minimum=0,maximum=100,step=1),Control("mute","Mute",group="audio"),Control("unmute","Unmute",group="audio"),Control("play_uri","Play URL",type="text",group="media",parameter="uri"),Control("spotify_play","Play from Spotify",type="media_search",group="spotify",parameter="query")]
    def _cast(self):
        import pychromecast
        casts,browser=pychromecast.get_chromecasts(timeout=5)
        try:
            ip=str(self.device.ip_address or ""); wanted=(self.config.get("friendly_name") or self.device.name).casefold()
            for cast in casts:
                info=cast.cast_info
                if (ip and str(getattr(info,"host",""))==ip) or str(getattr(info,"friendly_name","")).casefold()==wanted:
                    cast.wait(timeout=5); return cast
            raise IntegrationError("Google Cast device was not found")
        finally: pychromecast.discovery.stop_discovery(browser)
    async def get_state(self):
        def read():
            c=self._cast(); status=c.status; media=c.media_controller.status
            return {"online":True,"status":"on","power":"on","volume":round((status.volume_level or 0)*100),"muted":bool(status.volume_muted),"playback":getattr(media,"player_state",None),"media":{"title":getattr(media,"title",None),"artist":getattr(media,"artist",None)}}
        return await self.to_thread(read)
    async def _media(self,name): c=await self.to_thread(self._cast); return await self.to_thread(getattr(c.media_controller,name))
    async def action_play(self): return await self._media("play")
    async def action_pause(self): return await self._media("pause")
    async def action_stop(self): return await self._media("stop")
    async def action_volume(self,value): c=await self.to_thread(self._cast); value=max(0,min(100,int(value))); await self.to_thread(c.set_volume,value/100); return {"volume":value}
    async def action_mute(self): c=await self.to_thread(self._cast); await self.to_thread(c.set_volume_muted,True); return {"muted":True}
    async def action_unmute(self): c=await self.to_thread(self._cast); await self.to_thread(c.set_volume_muted,False); return {"muted":False}
    async def action_play_uri(self,uri,content_type="audio/mpeg"): c=await self.to_thread(self._cast); await self.to_thread(c.media_controller.play_media,uri,content_type); return {"uri":uri}
    async def action_spotify_play(self,query):
        s=SpotifyService(get_active_account("spotify",account_id=self.config.get("spotify_account_id")))
        return await self.to_thread(s.play_search,query,self.config.get("spotify_device_id"),self.config.get("spotify_device_name") or self.device.name)
