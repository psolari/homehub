from homehub.core.integrations.base import BaseDriver, Control, IntegrationError, TwoFactorRequired
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account, get_account_credentials, set_account_credentials


@register_driver
class RingCameraDriver(BaseDriver):
    driver_key="ring_camera"; device_type="camera"; display_name="Ring Camera / Doorbell"; manufacturer="Ring"
    config_schema=[{"name":"account_id","label":"Ring account ID","type":"number","required":True},{"name":"ring_device_id","label":"Ring device ID","type":"string","required":True},{"name":"family","label":"Ring family","type":"string","required":False}]
    controls=[Control("lights_on","Lights on",group="security"),Control("lights_off","Lights off",group="security"),Control("siren_on","Siren on",group="security"),Control("siren_off","Siren off",group="security"),Control("snapshot","Refresh camera",group="camera")]
    async def _ring(self):
        from ring_doorbell import Auth, Ring
        from ring_doorbell.exceptions import Requires2FAError
        account=get_active_account("ring",account_id=self.config.get("account_id")); creds=get_account_credentials(account)
        def token_updated(token): creds["token"]=token; set_account_credentials(account,creds)
        auth=Auth("HomeHub/1.0",creds.get("token"),token_updated)
        try:
            if not creds.get("token"): await auth.async_fetch_token(creds.get("username",""),creds.get("password",""),creds.get("otp"))
        except Requires2FAError as exc: raise TwoFactorRequired("Ring requires a one-time authentication code") from exc
        ring=Ring(auth)
        if hasattr(ring,"async_create_session"): await ring.async_create_session()
        if hasattr(ring,"async_update_data"): await ring.async_update_data()
        return ring
    async def _device(self):
        ring=await self._ring(); devices=ring.devices(); devices=await devices if hasattr(devices,"__await__") else devices; wanted=str(self.config.get("ring_device_id"))
        for family,values in (devices.items() if isinstance(devices,dict) else []):
            for dev in values or []:
                identity=str(getattr(dev,"device_id",getattr(dev,"id",getattr(dev,"account_id",""))))
                if identity==wanted or str(getattr(dev,"name",""))==wanted:return dev,family
        raise IntegrationError("Ring device was not found")
    @staticmethod
    def _attr(obj,name,default=None):
        value=getattr(obj,name,default)
        try:return value() if callable(value) else value
        except Exception:return default
    async def get_state(self):
        dev,family=await self._device(); return {"online":True,"status":"on","power":"on","family":family,"battery":self._attr(dev,"battery_life"),"wifi_signal":self._attr(dev,"wifi_signal_strength"),"lights":self._attr(dev,"lights"),"siren":self._attr(dev,"siren"),"camera_available":family in {"doorbells","doorbots","stickup_cams","cameras"}}
    async def _set(self,names,value=None):
        dev,_=await self._device()
        for name in names:
            fn=getattr(dev,name,None)
            if fn:
                result=fn() if value is None else fn(value); return await result if hasattr(result,"__await__") else result
        raise IntegrationError(f"Ring operation is not available: {names[0]}")
    async def action_lights_on(self): return await self._set(("async_set_lights","set_lights"),True)
    async def action_lights_off(self): return await self._set(("async_set_lights","set_lights"),False)
    async def action_siren_on(self): return await self._set(("async_set_siren","set_siren"),True)
    async def action_siren_off(self): return await self._set(("async_set_siren","set_siren"),False)
    async def action_snapshot(self): return {"available":(await self.camera_frame()) is not None}
    async def camera_frame(self):
        dev,_=await self._device()
        for name in ("async_get_snapshot","get_snapshot"):
            fn=getattr(dev,name,None)
            if fn:
                data=fn(); data=await data if hasattr(data,"__await__") else data
                if isinstance(data,bytes):return data,"image/jpeg"
        return None
