from types import SimpleNamespace

from django.test import SimpleTestCase

from homehub.core.services.roomba_tracking import (
    build_roomba_state,
    extract_roomba_location,
)


class RoombaTrackingStateTests(SimpleTestCase):
    def test_location_uses_roombapy_map_coordinates_and_scale(self):
        client = SimpleNamespace(
            master_state={
                "state": {
                    "reported": {
                        "pose": {
                            "point": {"x": 20, "y": 10},
                            "theta": 90,
                        },
                        "cleanMissionStatus": {"phase": "run"},
                        "batPct": 77,
                    }
                }
            },
            co_ords={"x": 10, "y": 20, "theta": 90},
            roomba_connected=True,
            cleanMissionStatus_phase="run",
        )

        location = extract_roomba_location(
            client,
            {
                "map_scale_x": 2,
                "map_scale_y": 0.5,
                "map_offset_x": 3,
                "map_offset_y": 4,
            },
        )

        self.assertEqual(
            location,
            {
                "x": 23.0,
                "y": 14.0,
                "heading": 90.0,
                "raw_x": 10.0,
                "raw_y": 20.0,
                "source": "roomba_mqtt",
            },
        )

        state = build_roomba_state(client, {})
        self.assertEqual(state["tracking_status"], "live")
        self.assertEqual(state["status"], "running")
        self.assertEqual(state["battery"], 77)

    def test_tracking_reports_waiting_until_pose_is_published(self):
        client = SimpleNamespace(
            master_state={
                "state": {
                    "reported": {
                        "cleanMissionStatus": {"phase": "charge"},
                    }
                }
            },
            co_ords={"x": 0, "y": 0, "theta": 180},
            roomba_connected=True,
            cleanMissionStatus_phase="charge",
        )

        state = build_roomba_state(client, {})

        self.assertIsNone(state["location"])
        self.assertEqual(state["tracking_status"], "waiting_for_pose")
        self.assertEqual(state["status"], "idle")
