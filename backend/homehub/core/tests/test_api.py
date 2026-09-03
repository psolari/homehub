from django.test import TestCase
from rest_framework.test import APIClient

from homehub.core.models import Device


class DeviceApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_manual_generic_device_can_be_added_without_login(self):
        response = self.client.post(
            "/api/v1/devices/",
            {
                "name": "Kitchen Sensor",
                "device_type": "sensor",
                "model": "generic",
                "source": "manual",
                "validate_connection": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Device.objects.count(), 1)

    def test_catalog_is_public_and_contains_setup_metadata(self):
        response = self.client.get("/api/v1/device-catalog/")
        self.assertEqual(response.status_code, 200)
        roomba = response.json()["vacuum"]["irobot_roomba"]
        self.assertTrue(roomba["setup"]["requires_ip"])
        self.assertTrue(roomba["setup"]["test_connection"])
        self.assertEqual(roomba["setup"]["actions"][0]["key"], "retrieve_password")

    def test_roomba_setup_rejects_missing_credentials_without_creating_device(self):
        response = self.client.post(
            "/api/v1/devices/complete-setup/",
            {
                "name": "Downstairs Roomba",
                "device_type": "vacuum",
                "model": "irobot_roomba",
                "source": "discovery",
                "ip_address": "192.168.1.50",
                "config": {},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Robot BLID", response.json()["error"])
        self.assertIn("Robot password", response.json()["error"])
        self.assertEqual(Device.objects.count(), 0)

    def test_roomba_password_action_requires_ip_before_hardware_access(self):
        response = self.client.post(
            "/api/v1/devices/setup-action/",
            {
                "device_type": "vacuum",
                "model": "irobot_roomba",
                "action": "retrieve_password",
                "device": {},
                "config": {},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("IP address", response.json()["error"])
        self.assertEqual(Device.objects.count(), 0)

    def test_generic_complete_setup_can_skip_connection_test(self):
        response = self.client.post(
            "/api/v1/devices/complete-setup/",
            {
                "name": "Passive Meter",
                "device_type": "sensor",
                "model": "generic",
                "source": "manual",
                "validate_connection": False,
                "config": {},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["device"]["name"], "Passive Meter")
        self.assertEqual(Device.objects.count(), 1)
