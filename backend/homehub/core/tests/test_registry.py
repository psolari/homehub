from django.test import SimpleTestCase
from homehub.core.integrations import get_driver_catalog

class RegistryTests(SimpleTestCase):
    def test_requested_integrations_are_registered(self):
        catalog=get_driver_catalog(); expected={("tv","lg_webos"),("tv","samsung_tizen"),("vacuum","irobot_roomba"),("speaker","sonos"),("speaker","google_cast"),("speaker","alexa_echo"),("thermostat","hive_heating"),("camera","ring_camera"),("security","ring_alarm_mqtt")}; actual={(dtype,key) for dtype,drivers in catalog.items() for key in drivers}; self.assertTrue(expected.issubset(actual))
