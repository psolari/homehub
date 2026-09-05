from django.test import SimpleTestCase

from homehub.core.services.roomba_cloud_tracking import RoombaCloudTrackingManager


class RoombaCloudTrackingTests(SimpleTestCase):
    def test_livemap_metres_are_normalised_to_centimetres(self):
        location = RoombaCloudTrackingManager._location(
            12.5,
            -3.0,
            90.0,
            {
                "map_scale_x": 2,
                "map_scale_y": 0.5,
                "map_offset_x": 1,
                "map_offset_y": 4,
            },
        )

        self.assertEqual(
            location,
            {
                "x": 26.0,
                "y": 2.5,
                "heading": 90.0,
                "raw_x": 12.5,
                "raw_y": -3.0,
                "raw_units": "centimetres",
                "source": "roomba_cloud_livemap",
            },
        )
