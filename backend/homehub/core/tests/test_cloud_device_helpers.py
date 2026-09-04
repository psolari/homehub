from types import SimpleNamespace

from django.test import SimpleTestCase

from homehub.core.services.hive_client import (
    hive_device_identity,
    is_hive_heating_device,
)
from homehub.core.services.ring_client import ring_device_groups


class HiveDiscoveryHelpersTests(SimpleTestCase):
    def test_heating_device_is_detected_from_type_metadata(self):
        device = {
            "deviceId": "heating-zone-1",
            "deviceType": "thermostat",
            "name": "Hall heating",
        }
        self.assertTrue(is_hive_heating_device(device))
        self.assertEqual(hive_device_identity(device), "heating-zone-1")

    def test_heating_device_is_detected_from_temperature_capability(self):
        device = SimpleNamespace(
            id="trv-1",
            current_temperature=20.5,
            target_temperature=21.0,
        )
        self.assertTrue(is_hive_heating_device(device))


class RingDeviceContainerTests(SimpleTestCase):
    def test_mapping_like_ring_devices_are_normalised(self):
        doorbell = SimpleNamespace(device_id="1", name="Front Door")
        camera = SimpleNamespace(device_id="2", name="Garden")

        class RingDevices:
            def __getitem__(self, family):
                values = {
                    "doorbots": [doorbell],
                    "stickup_cams": [camera],
                    "chimes": [],
                    "intercoms": [],
                }
                if family not in values:
                    raise KeyError(family)
                return values[family]

        ring = SimpleNamespace(devices=lambda: RingDevices())
        groups = ring_device_groups(ring)

        self.assertEqual(groups["doorbots"], [doorbell])
        self.assertEqual(groups["stickup_cams"], [camera])
