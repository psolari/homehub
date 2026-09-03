from unittest.mock import patch

from django.test import SimpleTestCase

from homehub.core.integrations.vacuum.roomba import RoombaDriver
from homehub.core.models import Device


class RoombaDriverTests(SimpleTestCase):
    @patch("roombapy.roomba_factory.RoombaFactory.create_roomba")
    def test_client_uses_roombapy_factory_api(self, create_roomba):
        sentinel = object()
        create_roomba.return_value = sentinel
        device = Device(
            name="Roomba",
            device_type="vacuum",
            model="irobot_roomba",
            ip_address="192.168.1.31",
            config={"blid": "robot-blid", "password": "robot-password"},
        )

        client = RoombaDriver(device)._client()

        self.assertIs(client, sentinel)
        create_roomba.assert_called_once_with(
            address="192.168.1.31",
            blid="robot-blid",
            password="robot-password",
            continuous=True,
        )
