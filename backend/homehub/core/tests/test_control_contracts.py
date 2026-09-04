from django.test import TestCase

from homehub.core.integrations import get_driver_catalog
from homehub.core.integrations.tv.lg import LGWebOSDriver
from homehub.core.models import Device


class ControlContractTests(TestCase):
    def test_lg_input_options_use_input_id_not_app_id(self):
        from aiowebostv.models import WebOsTvState

        state = WebOsTvState()
        state.is_on = True
        state.inputs = {
            "com.webos.app.hdmi3": {
                "id": "HDMI_3",
                "appId": "com.webos.app.hdmi3",
                "label": "HDMI 3",
            }
        }
        device = Device(
            name="LG TV",
            device_type="tv",
            model="lg_webos",
            ip_address="192.168.1.108",
        )

        result = LGWebOSDriver(device)._state(type("Client", (), {"tv_state": state})())

        self.assertEqual(result["inputs"], [{"value": "HDMI_3", "label": "HDMI 3"}])

    def test_binary_controls_are_exposed_as_single_toggles(self):
        catalog = get_driver_catalog()

        lg_actions = {
            control["action"]: control
            for control in catalog["tv"]["lg_webos"]["controls"]
        }
        self.assertIn("power", lg_actions)
        self.assertEqual(lg_actions["power"]["type"], "toggle")
        self.assertEqual(lg_actions["power"]["state_key"], "power")
        self.assertNotIn("power_on", lg_actions)
        self.assertNotIn("power_off", lg_actions)

        sonos_actions = {
            control["action"]: control
            for control in catalog["speaker"]["sonos"]["controls"]
        }
        self.assertEqual(sonos_actions["mute"]["type"], "toggle")
        self.assertNotIn("unmute", sonos_actions)

        ring_actions = {
            control["action"]: control
            for control in catalog["camera"]["ring_camera"]["controls"]
        }
        self.assertEqual(ring_actions["lights"]["type"], "toggle")
        self.assertEqual(ring_actions["siren"]["type"], "toggle")
        self.assertNotIn("lights_on", ring_actions)
        self.assertNotIn("lights_off", ring_actions)
