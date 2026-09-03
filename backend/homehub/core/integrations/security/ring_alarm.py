import json
from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account, get_account_credentials


@register_driver
class RingAlarmMQTTDriver(BaseDriver):
    driver_key="ring_alarm_mqtt"; device_type="security"; display_name="Ring Alarm (MQTT bridge)"; manufacturer="Ring"
    config_schema=[{"name":"account_id","label":"Ring Alarm MQTT account ID","type":"number","required":True},{"name":"topic","label":"Alarm MQTT topic","type":"string","required":True}]
    controls=[Control("arm_home","Arm home",group="alarm"),Control("arm_away","Arm away",group="alarm"),Control("disarm","Disarm",group="alarm")]
    def _publish(self,payload):
        import paho.mqtt.publish as publish
        creds=get_account_credentials(get_active_account("ring_alarm_mqtt",account_id=self.config.get("account_id"))); auth={"username":creds.get("username"),"password":creds.get("password")} if creds.get("username") else None
        publish.single(f"{self.config['topic'].rstrip('/')}/command",json.dumps(payload),hostname=creds.get("broker","localhost"),port=int(creds.get("port",1883)),auth=auth); return {"ok":True}
    async def get_state(self): return {"online":True,"status":self.device.state.get("status","unknown"),**(self.device.state or {})}
    async def action_arm_home(self): return await self.to_thread(self._publish,{"command":"arm_home"})
    async def action_arm_away(self): return await self.to_thread(self._publish,{"command":"arm_away"})
    async def action_disarm(self): return await self.to_thread(self._publish,{"command":"disarm"})
