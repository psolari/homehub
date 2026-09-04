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
