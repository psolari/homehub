from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from homehub.core.models import Device
from homehub.core.services.devices import refresh_device


class _Driver:
    def __init__(self, device, *, state=None, error=None):
        self.device = device
        self._state = state
        self._error = error

    def capabilities(self):
        return {"driver": "test", "controls": []}

    def consume_credential_updates(self):
        return {}

    async def get_state(self):
        if self._error:
            raise self._error
        return self._state


class DeviceRefreshResilienceTests(TestCase):
    def make_device(self):
        return Device.objects.create(
            name="Kitchen speaker",
            device_type="speaker",
            model="test",
            status="on",
            is_online=True,
            last_seen=timezone.now(),
            state={"online": True, "status": "on", "volume": 32},
        )

    def test_single_refresh_timeout_preserves_last_known_good_state(self):
        device = self.make_device()
        driver = _Driver(device, error=TimeoutError("slow response"))

        with patch(
            "homehub.core.services.devices.driver_for",
            return_value=driver,
        ):
            state = refresh_device(device)

        device.refresh_from_db()
        self.assertTrue(device.is_online)
        self.assertEqual(device.status, "on")
        self.assertEqual(state["volume"], 32)
        self.assertEqual(state["_refresh_failures"], 1)
        self.assertTrue(state["_refresh_degraded"])

    def test_repeated_stale_failures_eventually_mark_device_error(self):
        device = self.make_device()
        device.last_seen = timezone.now() - timedelta(minutes=2)
        device.save(update_fields=["last_seen"])

        for _ in range(3):
            driver = _Driver(device, error=TimeoutError("still unavailable"))
            with patch(
                "homehub.core.services.devices.driver_for",
                return_value=driver,
            ):
                refresh_device(device)
            device.refresh_from_db()

        self.assertFalse(device.is_online)
        self.assertEqual(device.status, "error")
        self.assertEqual(device.state["_refresh_failures"], 3)

    def test_successful_refresh_clears_transient_failure_metadata(self):
        device = self.make_device()
        device.state = {
            "online": True,
            "status": "on",
            "_refresh_failures": 2,
            "_refresh_error": "old timeout",
            "_refresh_degraded": True,
        }
        device.save(update_fields=["state"])
        driver = _Driver(
            device,
            state={"online": True, "status": "on", "volume": 40},
        )

        with patch(
            "homehub.core.services.devices.driver_for",
            return_value=driver,
        ):
            refresh_device(device)

        device.refresh_from_db()
        self.assertEqual(device.state, {"online": True, "status": "on", "volume": 40})
