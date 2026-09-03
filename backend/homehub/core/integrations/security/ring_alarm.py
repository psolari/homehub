import json

from homehub.core.integrations.base import BaseDriver, Control
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_account_credentials, get_active_account


@register_driver
class RingAlarmMQTTDriver(BaseDriver):
    driver_key = "ring_alarm_mqtt"
    device_type = "security"
    display_name = "Ring Alarm (MQTT bridge)"
    manufacturer = "Ring"
    config_schema = [
        {
            "name": "account_id",
            "label": "Ring Alarm MQTT account",
            "type": "number",
            "required": True,
            "description": "The HomeHub MQTT bridge integration that carries Ring Alarm commands.",
        },
        {
            "name": "topic",
            "label": "Alarm MQTT topic",
            "type": "string",
            "required": True,
            "description": "Base topic exposed by your Ring MQTT bridge for this alarm location/panel.",
        },
    ]
    setup_schema = {
        "description": "Connect a Ring Alarm panel through an MQTT bridge.",
        "requires_ip": False,
        "instructions": [
            "HomeHub controls Ring Alarm through an MQTT bridge rather than the Ring camera API.",
            "Choose or configure the MQTT bridge account, including broker host, port and optional broker credentials.",
            "Enter the base MQTT topic for the Ring Alarm panel/location exposed by your bridge.",
            "The setup test verifies that HomeHub can publish to the configured MQTT broker.",
        ],
        "account_provider": "ring_alarm_mqtt",
        "account_field": "account_id",
        "test_connection": True,
        "advanced_fields": [],
    }
    controls = [
        Control("arm_home", "Arm home", group="alarm"),
        Control("arm_away", "Arm away", group="alarm"),
        Control("disarm", "Disarm", group="alarm"),
    ]

    def _publish(self, payload):
        import paho.mqtt.publish as publish

        credentials = get_account_credentials(
            get_active_account("ring_alarm_mqtt", account_id=self.config.get("account_id"))
        )
        auth = (
            {"username": credentials.get("username"), "password": credentials.get("password")}
            if credentials.get("username")
            else None
        )
        publish.single(
            f"{self.config['topic'].rstrip('/')}/command",
            json.dumps(payload),
            hostname=credentials.get("broker", "localhost"),
            port=int(credentials.get("port", 1883)),
            auth=auth,
        )
        return {"ok": True}

    async def initialize(self):
        # Publish a harmless HomeHub availability probe to verify broker access
        # without arming/disarming the alarm.
        await self.to_thread(self._publish, {"command": "homehub_probe"})
        return {"online": True, "status": "unknown", "bridge": "connected"}

    async def get_state(self):
        return {
            "online": True,
            "status": self.device.state.get("status", "unknown"),
            **(self.device.state or {}),
        }

    async def action_arm_home(self):
        return await self.to_thread(self._publish, {"command": "arm_home"})

    async def action_arm_away(self):
        return await self.to_thread(self._publish, {"command": "arm_away"})

    async def action_disarm(self):
        return await self.to_thread(self._publish, {"command": "disarm"})
