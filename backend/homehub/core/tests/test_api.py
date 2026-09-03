from django.test import TestCase
from rest_framework.test import APIClient
from homehub.core.models import Device

class DeviceApiTests(TestCase):
    def setUp(self): self.client=APIClient()
    def test_manual_generic_device_can_be_added_without_login(self):
        response=self.client.post("/api/v1/devices/",{"name":"Kitchen Sensor","device_type":"sensor","model":"generic","source":"manual","validate_connection":False},format="json"); self.assertEqual(response.status_code,201); self.assertEqual(Device.objects.count(),1)
    def test_catalog_is_public(self): self.assertEqual(self.client.get("/api/v1/device-catalog/").status_code,200)
