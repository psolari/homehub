import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from homehub.core.integrations.tv.lg import LGWebOSDriver
from homehub.core.models import Device
from homehub.core.services.devices import create_device


class LGPairingRegressionTests(TestCase):
    def test_pairing_key_is_staged_without_async_orm_write(self):
        device = Device.objects.create(
            name="Living room TV",
            device_type="tv",
            model="lg_webos",
            ip_address="192.168.1.108",
        )

        class FakeWebOsClient:
            def __init__(self, host, client_key):
                self.host = host
                self.client_key = "paired-client-key"

            async def connect(self):
                return None

        fake_module = SimpleNamespace(WebOsClient=FakeWebOsClient)
        with patch.dict(sys.modules, {"aiowebostv": fake_module}):
            driver = LGWebOSDriver(device)
            client = asyncio.run(driver._client())

        self.assertEqual(client.client_key, "paired-client-key")
        self.assertEqual(
            driver.consume_credential_updates(),
            {"client_key": "paired-client-key"},
        )
        device.refresh_from_db()
        self.assertEqual(device.encrypted_credentials, "")


class NetworkIdentityTests(TestCase):
    @patch(
        "homehub.core.services.devices.resolve_mac_address",
        return_value="aa:bb:cc:dd:ee:ff",
    )
    def test_device_creation_auto_populates_mac_from_ip(self, resolve_mac):
        device = create_device(
            {
                "name": "Discovered appliance",
                "device_type": "appliance",
                "model": "generic",
                "ip_address": "192.168.1.50",
                "source": "discovery",
            },
            validate_connection=False,
        )

        resolve_mac.assert_called_once_with("192.168.1.50")
        self.assertEqual(device.mac_address, "aa:bb:cc:dd:ee:ff")
