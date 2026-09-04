import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.test import SimpleTestCase

from homehub.core.services.hive_client import HiveClientError, open_hive_session


class HiveClientTests(SimpleTestCase):
    def test_current_pyhive_session_contract_is_used(self):
        auth_instance = SimpleNamespace(login=AsyncMock(return_value={"accessToken": "token"}))
        hive_instance = SimpleNamespace(
            startSession=AsyncMock(),
            session=SimpleNamespace(
                data=SimpleNamespace(devices={"heating-1": {"id": "heating-1"}})
            ),
        )

        class FakeAuth:
            def __new__(cls, *, username, password):
                self.assertEqual(username, "owner@example.com")
                self.assertEqual(password, "correct-password")
                return auth_instance

        class FakeHive:
            def __new__(cls, *, username, password):
                self.assertEqual(username, "owner@example.com")
                self.assertEqual(password, "correct-password")
                return hive_instance

        fake_module = SimpleNamespace(Auth=FakeAuth, Hive=FakeHive)

        with patch.dict(sys.modules, {"apyhiveapi": fake_module}):
            result = asyncio.run(
                open_hive_session(
                    {
                        "username": "owner@example.com",
                        "password": "correct-password",
                    }
                )
            )

        self.assertIs(result, hive_instance)
        auth_instance.login.assert_awaited_once_with()
        hive_instance.startSession.assert_awaited_once_with(
            {"tokens": {"accessToken": "token"}}
        )

    def test_empty_library_exception_is_reported_with_context(self):
        class EmptyHiveError(Exception):
            pass

        auth_instance = SimpleNamespace(login=AsyncMock(side_effect=EmptyHiveError()))

        class FakeAuth:
            def __new__(cls, *, username, password):
                return auth_instance

        class FakeHive:
            pass

        fake_module = SimpleNamespace(Auth=FakeAuth, Hive=FakeHive)

        with patch.dict(sys.modules, {"apyhiveapi": fake_module}):
            with self.assertRaisesRegex(
                HiveClientError,
                r"Hive authentication failed \(EmptyHiveError\)",
            ):
                asyncio.run(
                    open_hive_session(
                        {
                            "username": "owner@example.com",
                            "password": "correct-password",
                        }
                    )
                )

    def test_sms_two_factor_requirement_is_explained(self):
        HiveSmsRequired = type("HiveSmsRequired", (Exception,), {})
        auth_instance = SimpleNamespace(
            login=AsyncMock(side_effect=HiveSmsRequired())
        )

        class FakeAuth:
            def __new__(cls, *, username, password):
                return auth_instance

        fake_module = SimpleNamespace(Auth=FakeAuth, Hive=object)

        with patch.dict(sys.modules, {"apyhiveapi": fake_module}):
            with self.assertRaisesRegex(
                HiveClientError,
                "requires SMS two-factor authentication",
            ):
                asyncio.run(
                    open_hive_session(
                        {
                            "username": "owner@example.com",
                            "password": "correct-password",
                        }
                    )
                )
