from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account, get_account_credentials


@register_driver
class HiveHeatingDriver(BaseDriver):
    driver_key="hive_heating"; device_type="thermostat"; display_name="Hive Heating"; manufacturer="Hive"
    config_schema=[{"name":"account_id","label":"Hive account ID","type":"number","required":True},{"name":"hive_device_id","label":"Hive heating device ID","type":"string","required":True}]
    controls=[Control("target_temperature","Target temperature",type="range",group="heating",parameter="value",minimum=5,maximum=32,step=.5),Control("mode","Mode",type="select",group="heating",parameter="value",options=[{"value":"SCHEDULE","label":"Schedule"},{"value":"MANUAL","label":"Manual"},{"value":"OFF","label":"Off"}]),Control("boost","Boost",type="number_pair",group="heating"),Control("boost_off","Stop boost",group="heating")]
    async def _session(self):
        from apyhiveapi import Auth, Hive
        creds=get_account_credentials(get_active_account("hive",account_id=self.config.get("account_id"))); auth=Auth(creds.get("username",""),creds.get("password","")); tokens=await auth.login(); hive=Hive(tokens); await hive.startSession(tokens); return hive
    async def _device(self):
        hive=await self._session(); wanted=str(self.config.get("hive_device_id")); data=getattr(getattr(hive,"session",None),"data",None); devices=getattr(data,"devices",data)
        if isinstance(devices,dict): device=devices.get(wanted) or next((v for k,v in devices.items() if str(k)==wanted),None)
        else: device=next((d for d in (devices or []) if str(getattr(d,"id",getattr(d,"device_id","")))==wanted),None)
        if device is None: raise IntegrationError("Hive heating device was not found")
        return hive,device
    @staticmethod
    def _value(obj,*names,default=None):
        for name in names:
            if isinstance(obj,dict) and name in obj:return obj[name]
            if hasattr(obj,name):return getattr(obj,name)
        return default
    async def get_state(self):
        _,d=await self._device(); return {"online":True,"status":"on","power":"on","temperature":self._value(d,"current_temperature","temperature","currentTemperature"),"target_temperature":self._value(d,"target_temperature","target","targetTemperature"),"mode":self._value(d,"mode","heating_mode",default="unknown"),"boost":self._value(d,"boost","boost_status")}
    async def _invoke(self,names,*args):
        hive,d=await self._device()
        for holder in (d,getattr(hive,"heating",None),hive):
            if holder:
                for name in names:
                    fn=getattr(holder,name,None)
                    if fn:
                        result=fn(*args); return await result if hasattr(result,"__await__") else result
        raise IntegrationError(f"Hive operation is unavailable: {names[0]}")
    async def action_target_temperature(self,value): return await self._invoke(("set_target_temperature","setTargetTemperature"),float(value))
    async def action_mode(self,value): return await self._invoke(("set_mode","setMode"),str(value).upper())
    async def action_boost(self,minutes=30,temperature=22): return await self._invoke(("boost","set_boost","setBoost"),int(minutes),float(temperature))
    async def action_boost_off(self): return await self._invoke(("boost_off","cancel_boost","cancelBoost"))
