from django.test import TestCase
from homehub.core.models import Device, FloorPlan, FloorPlanObject
from homehub.core.services.device_config import get_device_credentials
from homehub.core.services.devices import create_device


class DomainModelTests(TestCase):
    def test_floor_plan_can_link_a_device(self):
        plan=FloorPlan.objects.create(name="Ground Floor"); device=Device.objects.create(name="TV",device_type="tv",model="generic"); obj=FloorPlanObject.objects.create(floor_plan=plan,object_type="device",device=device,x=100,y=200); self.assertEqual(obj.device,device); self.assertEqual(plan.objects.count(),1)
    def test_device_secret_config_is_not_stored_in_plaintext(self):
        device=create_device({"name":"Living room TV","device_type":"tv","model":"samsung_tizen","ip_address":"192.0.2.10","config":{"token":"pairing-secret","port":8002}},validate_connection=False); self.assertEqual(device.config,{"port":8002}); self.assertEqual(get_device_credentials(device)["token"],"pairing-secret"); self.assertNotIn("pairing-secret",device.encrypted_credentials)
