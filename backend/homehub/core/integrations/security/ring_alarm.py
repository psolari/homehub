import json
import time

from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
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
            "The setup test connects and authenticates to the MQTT broker without sending any alarm command.",
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

    def _credentials(self):
        return get_account_credentials(
            get_active_account("ring_alarm_mqtt", account_id=self.config.get("account_id"))
        )

    def _publish(self, payload):
        import paho.mqtt.publish as publish

        credentials = self._credentials()
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

    def _test_broker(self):
        import paho.mqtt.client as mqtt

        credentials = self._credentials()
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if credentials.get("username"):
            client.username_pw_set(credentials.get("username"), credentials.get("password"))
        host = credentials.get("broker", "localhost")
        port = int(credentials.get("port", 1883))
        try:
            result = client.connect(host, port, keepalive=5)
            if result != mqtt.MQTT_ERR_SUCCESS:
                raise IntegrationError(f"MQTT broker connection failed with code {result}")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not client.is_connected():
                loop_result = client.loop(timeout=0.2)
                if loop_result not in {mqtt.MQTT_ERR_SUCCESS, mqtt.MQTT_ERR_AGAIN}:
                    raise IntegrationError(f"MQTT broker authentication failed with code {loop_result}")
            if not client.is_connected():
                raise IntegrationError("MQTT broker did not accept the HomeHub connection")
            return {"ok": True}
        finally:
            try:
                client.disconnect()
            except Exception:
                pass

    async def initialize(self):
        await self.to_thread(self._test_broker)
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
