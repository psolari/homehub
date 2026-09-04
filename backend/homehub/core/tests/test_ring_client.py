import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from django.test import SimpleTestCase

from homehub.core.services.ring_client import open_ring_session


class RingClientSessionTests(SimpleTestCase):
    def test_device_discovery_bypasses_legacy_clients_api_session(self):
        auth_instance = SimpleNamespace(
            async_fetch_token=AsyncMock(),
        )
        ring_instance = SimpleNamespace(
            session=None,
            async_create_session=AsyncMock(
                side_effect=AssertionError("legacy Ring session endpoint must not be called")
            ),
            async_update_devices=AsyncMock(),
        )

        Auth = Mock(return_value=auth_instance)
        Ring = Mock(return_value=ring_instance)
        fake_ring = SimpleNamespace(Auth=Auth, Ring=Ring)
        fake_exceptions = SimpleNamespace(
            Requires2FAError=type("Requires2FAError", (Exception,), {})
        )

        with patch.dict(
            sys.modules,
            {
                "ring_doorbell": fake_ring,
                "ring_doorbell.exceptions": fake_exceptions,
            },
        ):
            result, token = asyncio.run(
                open_ring_session(
                    {
                        "username": "owner@example.com",
                        "password": "correct-password",
                        "token": {"access_token": "cached"},
                    }
                )
            )

        self.assertIs(result, ring_instance)
        self.assertIsNone(token)
        ring_instance.async_create_session.assert_not_awaited()
        ring_instance.async_update_devices.assert_awaited_once_with()
        self.assertEqual(ring_instance.session, {"homehub": True})

    def test_fresh_ring_login_updates_devices_without_legacy_session(self):
        token_value = {"access_token": "fresh"}
        auth_instance = SimpleNamespace(
            async_fetch_token=AsyncMock(return_value=token_value),
        )
        ring_instance = SimpleNamespace(
            session=None,
            async_create_session=AsyncMock(),
            async_update_devices=AsyncMock(),
        )

        def fake_auth(user_agent, token, token_updated):
            self.assertEqual(user_agent, "HomeHub/1.0")
            self.assertIsNone(token)
            auth_instance.token_updated = token_updated
            return auth_instance

        def fetch_token(username, password, otp=None):
            auth_instance.token_updated(token_value)

        auth_instance.async_fetch_token = AsyncMock(side_effect=fetch_token)

        fake_ring = SimpleNamespace(Auth=fake_auth, Ring=Mock(return_value=ring_instance))
        fake_exceptions = SimpleNamespace(
            Requires2FAError=type("Requires2FAError", (Exception,), {})
        )

        with patch.dict(
            sys.modules,
            {
                "ring_doorbell": fake_ring,
                "ring_doorbell.exceptions": fake_exceptions,
            },
        ):
            result, token = asyncio.run(
                open_ring_session(
                    {
                        "username": "owner@example.com",
                        "password": "correct-password",
                    }
                )
            )

        self.assertIs(result, ring_instance)
        self.assertEqual(token, token_value)
        ring_instance.async_create_session.assert_not_awaited()
        ring_instance.async_update_devices.assert_awaited_once_with()
