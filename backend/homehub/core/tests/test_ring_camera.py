import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from django.test import SimpleTestCase

from homehub.core.integrations.base import IntegrationError
from homehub.core.integrations.security.ring import RingCameraDriver


class RingCameraSnapshotTests(SimpleTestCase):
    def driver(self):
        device = SimpleNamespace(
            config={},
            encrypted_credentials=b"",
            name="Front Door",
        )
        return RingCameraDriver(device)

    def test_async_snapshot_api_is_preferred(self):
        driver = self.driver()
        snapshot = AsyncMock(return_value=b"jpeg-data")
        ring_device = SimpleNamespace(async_get_snapshot=snapshot)
        driver._device = AsyncMock(
            return_value=(ring_device, "doorbots", SimpleNamespace(auth=None))
        )

        result = asyncio.run(driver.camera_frame())

        self.assertEqual(result, (b"jpeg-data", "image/jpeg"))
        snapshot.assert_awaited_once_with(retries=10, delay=1)

    def test_deprecated_sync_snapshot_runs_in_worker_thread(self):
        driver = self.driver()
        running_loop_seen = {"value": None}

        def sync_snapshot():
            try:
                asyncio.get_running_loop()
                running_loop_seen["value"] = True
            except RuntimeError:
                running_loop_seen["value"] = False
            return b"jpeg-data"

        ring_device = SimpleNamespace(get_snapshot=sync_snapshot)
        driver._device = AsyncMock(
            return_value=(ring_device, "doorbots", SimpleNamespace(auth=None))
        )

        result = asyncio.run(driver.camera_frame())

        self.assertEqual(result, (b"jpeg-data", "image/jpeg"))
        self.assertFalse(running_loop_seen["value"])


    def test_missing_fresh_snapshot_is_reported_as_ring_error(self):
        driver = self.driver()
        snapshot = AsyncMock(return_value=None)
        ring_device = SimpleNamespace(async_get_snapshot=snapshot)
        driver._device = AsyncMock(
            return_value=(ring_device, "doorbots", SimpleNamespace(auth=None))
        )

        with self.assertRaisesRegex(
            IntegrationError,
            "accepted the snapshot request but did not publish a fresh image",
        ):
            asyncio.run(driver.camera_frame())

        snapshot.assert_awaited_once_with(retries=10, delay=1)
