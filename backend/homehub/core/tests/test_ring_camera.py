import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

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

    @patch(
        "homehub.core.integrations.security.ring.take_ring_snapshot",
        new_callable=AsyncMock,
    )
    def test_camera_frame_uses_reliable_snapshot_helper(self, take_snapshot):
        driver = self.driver()
        take_snapshot.return_value = b"jpeg-data"
        ring_device = SimpleNamespace()
        ring = SimpleNamespace(auth=None)
        driver._device = AsyncMock(
            return_value=(ring_device, "doorbots", ring)
        )

        result = asyncio.run(driver.camera_frame())

        self.assertEqual(result, (b"jpeg-data", "image/jpeg"))
        take_snapshot.assert_awaited_once_with(
            ring,
            ring_device,
            max_age=30,
            max_wait=12,
        )

    @patch(
        "homehub.core.integrations.security.ring.take_ring_snapshot",
        new_callable=AsyncMock,
    )
    def test_snapshot_helper_errors_are_exposed_as_integration_errors(
        self,
        take_snapshot,
    ):
        driver = self.driver()
        take_snapshot.side_effect = RuntimeError(
            "Ring did not produce a snapshot before its server-side timeout."
        )
        driver._device = AsyncMock(
            return_value=(
                SimpleNamespace(),
                "doorbots",
                SimpleNamespace(auth=None),
            )
        )

        with self.assertRaisesRegex(
            IntegrationError,
            "server-side timeout",
        ):
            asyncio.run(driver.camera_frame())
