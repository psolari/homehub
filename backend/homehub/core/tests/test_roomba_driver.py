from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from homehub.core.integrations.vacuum.roomba import RoombaDriver
from homehub.core.models import Device


class RoombaDriverTests(SimpleTestCase):
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_tracking_manager.ensure"
    )
    def test_driver_reuses_persistent_tracking_client(self, ensure):
        sentinel = object()
        ensure.return_value = sentinel
        device = Device(
            name="Roomba",
            device_type="vacuum",
            model="irobot_roomba",
            ip_address="192.168.1.31",
            config={"blid": "robot-blid", "password": "robot-password"},
        )
        driver = RoombaDriver(device)

        client = driver._tracked_client()

        self.assertIs(client, sentinel)
        ensure.assert_called_once_with(device, driver.config)

    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_cloud_tracking_manager.diagnostics"
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_cloud_tracking_manager.location"
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_cloud_tracking_manager.ensure"
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_tracking_manager.wait_until_ready"
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_tracking_manager.ensure"
    )
    def test_pose_capability_two_uses_cloud_livemap_fallback(
        self,
        local_ensure,
        wait_until_ready,
        cloud_ensure,
        cloud_location,
        cloud_diagnostics,
    ):
        local_ensure.return_value = SimpleNamespace(
            master_state={
                "state": {
                    "reported": {
                        "cap": {"pose": 2},
                        "cleanMissionStatus": {"phase": "run"},
                        "batPct": 54,
                    }
                }
            },
            co_ords={"x": 0, "y": 0, "theta": 180},
            roomba_connected=True,
            cleanMissionStatus_phase="run",
        )
        cloud_location.return_value = {
            "x": 12.3,
            "y": -4.5,
            "raw_x": 12.3,
            "raw_y": -4.5,
            "heading": 90,
            "source": "roomba_cloud_livemap",
        }
        cloud_diagnostics.return_value = {
            "configured": True,
            "status": "live",
        }
        device = Device(
            id=1,
            name="Roomba",
            device_type="vacuum",
            model="irobot_roomba",
            ip_address="192.168.1.31",
            config={"blid": "robot-blid", "password": "robot-password"},
        )
        driver = RoombaDriver(device)

        state = driver._read_tracked()

        self.assertEqual(state["pose_capability"], 2)
        self.assertEqual(state["tracking_status"], "live_cloud")
        self.assertEqual(state["location"]["source"], "roomba_cloud_livemap")
        cloud_ensure.assert_called_once_with(device, driver.config)
        wait_until_ready.assert_called_once_with(device.id, timeout=2.5)

    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_cloud_tracking_manager.diagnostics",
        return_value={"configured": False, "status": "account_required"},
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_cloud_tracking_manager.location",
        return_value=None,
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_cloud_tracking_manager.ensure"
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_tracking_manager.wait_until_ready"
    )
    @patch(
        "homehub.core.integrations.vacuum.roomba.roomba_tracking_manager.ensure"
    )
    def test_pose_capability_two_explains_when_cloud_account_is_required(
        self,
        local_ensure,
        wait_until_ready,
        cloud_ensure,
        cloud_location,
        cloud_diagnostics,
    ):
        local_ensure.return_value = SimpleNamespace(
            master_state={
                "state": {
                    "reported": {
                        "cap": {"pose": 2},
                        "cleanMissionStatus": {"phase": "run"},
                    }
                }
            },
            co_ords={"x": 0, "y": 0, "theta": 180},
            roomba_connected=True,
            cleanMissionStatus_phase="run",
        )
        device = Device(
            id=1,
            name="Roomba",
            device_type="vacuum",
            model="irobot_roomba",
            ip_address="192.168.1.31",
            config={"blid": "robot-blid", "password": "robot-password"},
        )

        state = RoombaDriver(device)._read_tracked()

        self.assertEqual(state["tracking_status"], "cloud_account_required")
        self.assertIsNone(state["location"])

