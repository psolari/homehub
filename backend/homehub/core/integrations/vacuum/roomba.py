import time
from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver


@register_driver
class RoombaDriver(BaseDriver):
    driver_key="irobot_roomba"; device_type="vacuum"; display_name="iRobot Roomba"; manufacturer="iRobot"
    config_schema=[{"name":"blid","label":"BLID","type":"string","required":True,"secret":True},{"name":"password","label":"Password","type":"password","required":True,"secret":True},{"name":"map_scale_x","label":"Floor-plan X scale","type":"number","default":1},{"name":"map_scale_y","label":"Floor-plan Y scale","type":"number","default":1},{"name":"map_offset_x","label":"Floor-plan X offset","type":"number","default":0},{"name":"map_offset_y","label":"Floor-plan Y offset","type":"number","default":0}]
    controls=[Control("start","Start",group="cleaning"),Control("pause","Pause",group="cleaning"),Control("resume","Resume",group="cleaning"),Control("stop","Stop",group="cleaning"),Control("dock","Dock",group="cleaning")]
    def _client(self):
        try: from roombapy.roomba import Roomba
        except ImportError:
            try: from roombapy import Roomba
            except ImportError as exc: raise IntegrationError("roombapy is not installed") from exc
        return Roomba(address=self.device.ip_address,blid=self.config.get("blid"),password=self.config.get("password"),continuous=True)
    def _with(self,callback):
        c=self._client()
        try:c.connect(); time.sleep(.8); return callback(c)
        finally:
            try:c.disconnect()
            except Exception:pass
    def _read(self,c):
        master=c.master_state or {}; state=master.get("state",master); reported=state.get("reported",state) if isinstance(state,dict) else {}; mission=reported.get("cleanMissionStatus") or {}; phase=mission.get("phase") or "unknown"; pose=reported.get("pose") or reported.get("pose2") or {}; point=pose.get("point",pose) if isinstance(pose,dict) else {}; location=None
        try:
            rx,ry=float(point.get("x")),float(point.get("y")); location={"x":rx*float(self.config.get("map_scale_x",1) or 1)+float(self.config.get("map_offset_x",0) or 0),"y":ry*float(self.config.get("map_scale_y",1) or 1)+float(self.config.get("map_offset_y",0) or 0),"heading":float(pose.get("theta",0) or 0),"raw_x":rx,"raw_y":ry}
        except (TypeError,ValueError):pass
        return {"online":True,"status":"running" if phase in {"run","hmUsrDock","hmMidMsn","charge"} else "idle","power":"on","battery":reported.get("batPct"),"phase":phase,"mission":mission,"location":location,"bin_full":bool((reported.get("bin") or {}).get("full")) if isinstance(reported.get("bin"),dict) else None}
    async def get_state(self): return await self.to_thread(self._with,self._read)
    async def _command(self,command):
        def send(c): c.send_command(command); time.sleep(.25); return {"ok":True,"command":command}
        return await self.to_thread(self._with,send)
    async def action_start(self): return await self._command("start")
    async def action_pause(self): return await self._command("pause")
    async def action_resume(self): return await self._command("resume")
    async def action_stop(self): return await self._command("stop")
    async def action_dock(self): return await self._command("dock")
