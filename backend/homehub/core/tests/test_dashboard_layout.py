from django.test import TestCase
from rest_framework.test import APIClient

from homehub.core.models import DashboardCard, DashboardGroup, Device


class DashboardLayoutApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.devices = [
            Device.objects.create(
                name=f"Device {index}",
                device_type="switch",
                model="generic",
            )
            for index in range(1, 4)
        ]
        self.cards = [
            DashboardCard.objects.create(
                device=self.devices[index],
                grid_x=index * 4,
                grid_y=0,
                grid_w=4,
                grid_h=3,
            )
            for index in range(3)
        ]

    def test_atomic_layout_allows_card_swap(self):
        response = self.client.post(
            "/api/v1/dashboard-cards/layout/",
            {
                "cards": [
                    {
                        "id": self.cards[0].id,
                        "grid_x": 4,
                        "grid_y": 0,
                        "grid_w": 4,
                        "grid_h": 3,
                    },
                    {
                        "id": self.cards[1].id,
                        "grid_x": 0,
                        "grid_y": 0,
                        "grid_w": 4,
                        "grid_h": 3,
                    },
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.cards[0].refresh_from_db()
        self.cards[1].refresh_from_db()
        self.assertEqual(self.cards[0].grid_x, 4)
        self.assertEqual(self.cards[1].grid_x, 0)

    def test_layout_rejects_overlapping_cards(self):
        response = self.client.post(
            "/api/v1/dashboard-cards/layout/",
            {
                "cards": [
                    {
                        "id": self.cards[0].id,
                        "grid_x": 4,
                        "grid_y": 0,
                        "grid_w": 4,
                        "grid_h": 3,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap", response.data["error"].lower())
        self.cards[0].refresh_from_db()
        self.assertEqual(self.cards[0].grid_x, 0)

    def test_layout_can_move_card_between_groups_without_overlap(self):
        group = DashboardGroup.objects.create(name="Media", order=0)

        response = self.client.post(
            "/api/v1/dashboard-cards/layout/",
            {
                "cards": [
                    {
                        "id": self.cards[0].id,
                        "group": group.id,
                        "grid_x": 0,
                        "grid_y": 0,
                        "grid_w": 4,
                        "grid_h": 3,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.cards[0].refresh_from_db()
        self.assertEqual(self.cards[0].group_id, group.id)
