from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from homehub.core.models import IntegrationAccount
from homehub.core.services.accounts import set_credentials
from homehub.core.services.discovery import discover_cloud_accounts


class IntegrationAccountConnectionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.account = IntegrationAccount.objects.create(
            provider="hive",
            name="Default",
        )
        set_credentials(
            self.account,
            {"username": "user@example.com", "password": "secret"},
        )

    @patch(
        "homehub.core.views.discover_account",
        side_effect=RuntimeError("Hive rejected these credentials"),
    )
    def test_invalid_credentials_are_not_marked_connected(self, discover):
        response = self.client.post(
            f"/api/v1/integration-accounts/{self.account.id}/connect/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.account.refresh_from_db()
        self.assertEqual(self.account.status, "error")
        self.assertIn("Hive rejected", self.account.error)
        self.assertNotIn("verified_at", self.account.metadata)
        discover.assert_called_once_with(self.account)

    @patch("homehub.core.views.discover_account")
    def test_successful_hive_discovery_is_single_pass_verification(
        self,
        discover,
    ):
        discover.return_value = [
            {
                "unique_id": "hive:zone-1",
                "name": "Heating",
                "device_type": "thermostat",
                "model": "hive_heating",
            }
        ]

        response = self.client.post(
            f"/api/v1/integration-accounts/{self.account.id}/connect/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.account.refresh_from_db()
        self.assertEqual(self.account.status, "connected")
        self.assertEqual(self.account.metadata["discovered_devices_count"], 1)
        self.assertIn("authenticated successfully", response.data["connection"]["message"])
        self.assertIn("verified_at", self.account.metadata)
        discover.assert_called_once_with(self.account)

    def test_changing_credentials_marks_account_unverified(self):
        self.account.status = "connected"
        self.account.metadata = {"verified_at": "2026-09-04T21:00:00+01:00"}
        self.account.save(update_fields=["status", "metadata"])

        response = self.client.patch(
            f"/api/v1/integration-accounts/{self.account.id}/",
            {"credentials": {"password": "replacement"}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.account.refresh_from_db()
        self.assertEqual(self.account.status, "disconnected")



class IRobotIntegrationAccountTests(TestCase):
    @patch("roombapy_prime.auth.login", new_callable=AsyncMock)
    def test_irobot_account_validation_counts_visible_robots(self, login):
        login.return_value = SimpleNamespace(
            robots={
                "BLID-1": SimpleNamespace(),
                "BLID-2": SimpleNamespace(),
            }
        )
        account = IntegrationAccount.objects.create(
            provider="irobot",
            name="Default",
        )
        set_credentials(
            account,
            {
                "username": "user@example.com",
                "password": "secret",
                "country_code": "GB",
            },
        )

        from homehub.core.services.integration_accounts import (
            validate_integration_account,
        )

        result = validate_integration_account(account)

        self.assertEqual(result["provider_devices_seen"], 2)
        self.assertEqual(result["robot_blids"], ["BLID-1", "BLID-2"])
        self.assertIn("verified_at", result)
        args = login.await_args.args
        self.assertEqual(args[1:], ("user@example.com", "secret", "GB"))


class VerifiedCloudDiscoveryTests(TestCase):
    @patch("homehub.core.services.discovery.discover_account")
    def test_legacy_connected_account_without_verification_is_ignored(self, discover):
        IntegrationAccount.objects.create(
            provider="hive",
            name="Legacy",
            status="connected",
            metadata={},
        )

        result = discover_cloud_accounts()

        self.assertEqual(result, [])
        discover.assert_not_called()
