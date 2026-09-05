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
            discovery_data={},
            state={},
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



class RingCameraCapabilityTests(SimpleTestCase):
    def driver(
        self,
        *,
        family: str,
        state: dict | None = None,
        discovery_data: dict | None = None,
    ):
        device = SimpleNamespace(
            config={"family": family},
            discovery_data=discovery_data or {},
            state=state or {},
            encrypted_credentials=b"",
            name="Ring device",
        )
        return RingCameraDriver(device)

    def test_doorbell_advertises_snapshot_only(self):
        driver = self.driver(
            family="doorbots",
            state={
                "supports_lights": True,
                "supports_siren": True,
            },
            discovery_data={
                "ring_capabilities": ["video", "light", "siren"],
            },
        )

        actions = [
            item["action"]
            for item in driver.capabilities()["controls"]
        ]

        self.assertEqual(actions, ["snapshot"])

    def test_camera_only_advertises_hardware_supported_controls(self):
        driver = self.driver(
            family="stickup_cams",
            discovery_data={
                "ring_capabilities": ["video", "light"],
            },
        )

        actions = [
            item["action"]
            for item in driver.capabilities()["controls"]
        ]

        self.assertEqual(actions, ["snapshot", "lights"])

    def test_siren_is_not_assumed_for_unknown_ring_camera(self):
        driver = self.driver(family="stickup_cams")

        actions = [
            item["action"]
            for item in driver.capabilities()["controls"]
        ]

        self.assertEqual(actions, ["snapshot"])
