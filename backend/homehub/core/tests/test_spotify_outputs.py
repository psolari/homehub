from django.test import TestCase

from homehub.core.models import Device
from homehub.core.views import SpotifyPlayerViewSet


class _SpotifyDevices:
    def __init__(self, devices):
        self._devices = devices

    def devices(self):
        return self._devices


class SpotifyOutputTests(TestCase):
    def test_sonos_is_available_as_local_homehub_output(self):
        speaker = Device.objects.create(
            name="Living Room",
            device_type="speaker",
            model="sonos",
            status="idle",
            is_online=True,
            state={"online": True, "status": "idle", "volume": 28},
        )

        outputs = SpotifyPlayerViewSet()._outputs(_SpotifyDevices([]))

        output = next(item for item in outputs if item["homehub_device_id"] == speaker.id)
        self.assertTrue(output["available"])
        self.assertEqual(output["output_id"], f"homehub:{speaker.id}")
        self.assertEqual(output["playback_mode"], "homehub")

    def test_connect_id_is_remembered_when_spotify_exposes_speaker(self):
        speaker = Device.objects.create(
            name="Kitchen speaker",
            device_type="speaker",
            model="google_cast",
            status="on",
            is_online=True,
            config={},
            state={"online": True, "status": "on", "volume": 35},
        )
        service = _SpotifyDevices(
            [
                {
                    "id": "spotify-kitchen-id",
                    "name": "Kitchen speaker",
                    "type": "CastAudio",
                    "is_active": False,
                    "is_restricted": False,
                    "volume_percent": 35,
                    "supports_volume": True,
                }
            ]
        )

        outputs = SpotifyPlayerViewSet()._outputs(service)

        speaker.refresh_from_db()
        self.assertEqual(speaker.config["spotify_device_id"], "spotify-kitchen-id")
        output = next(item for item in outputs if item["homehub_device_id"] == speaker.id)
        self.assertEqual(output["output_id"], "spotify-kitchen-id")
        self.assertTrue(output["available"])

    def test_remembered_connect_id_stays_selectable_when_device_list_is_transient(self):
        speaker = Device.objects.create(
            name="Kitchen speaker",
            device_type="speaker",
            model="google_cast",
            status="on",
            is_online=True,
            config={
                "spotify_device_id": "remembered-kitchen-id",
                "spotify_device_name": "Kitchen speaker",
            },
            state={"online": True, "status": "on", "volume": 35},
        )

        outputs = SpotifyPlayerViewSet()._outputs(_SpotifyDevices([]))

        output = next(item for item in outputs if item["homehub_device_id"] == speaker.id)
        self.assertEqual(output["output_id"], "remembered-kitchen-id")
        self.assertEqual(output["playback_mode"], "remembered_connect")
        self.assertTrue(output["available"])
