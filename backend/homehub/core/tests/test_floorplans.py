from django.test import TestCase
from rest_framework.test import APIClient

from homehub.core.models import FloorPlan, Room


class FloorPlanEditorTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.plan = FloorPlan.objects.create(name="Ground Floor", width=1200, height=800)

    def test_room_geometry_round_trips_through_floor_plan_api(self):
        Room.objects.create(
            floor_plan=self.plan,
            name="Living Room",
            x=40,
            y=50,
            width=420,
            height=300,
            properties={"wall_thickness": 14},
        )
        response = self.client.get("/api/v1/floor-plans/")
        self.assertEqual(response.status_code, 200)
        room = response.json()[0]["rooms"][0]
        self.assertEqual(room["name"], "Living Room")
        self.assertEqual(room["width"], 420.0)
        self.assertEqual(room["properties"]["wall_thickness"], 14)

    def test_room_can_be_resized_through_api(self):
        room = Room.objects.create(floor_plan=self.plan, name="Kitchen")
        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            {"x": 100, "y": 120, "width": 360, "height": 260},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        room.refresh_from_db()
        self.assertEqual(room.width, 360)
        self.assertEqual(room.height, 260)
