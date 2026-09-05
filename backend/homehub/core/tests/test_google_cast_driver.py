from unittest.mock import MagicMock, patch
from uuid import UUID

from django.test import TestCase

from homehub.core.integrations.speaker.google_cast import GoogleCastDriver
from homehub.core.models import Device


class GoogleCastDriverTests(TestCase):
    def make_device(self, config=None):
        return Device.objects.create(
            name="Kitchen speaker",
            device_type="speaker",
            model="google_cast",
            ip_address="192.168.1.68",
            config=config or {"friendly_name": "Kitchen speaker"},
        )

    def test_cast_connects_directly_to_saved_host_without_mdns_browser(self):
        cast = MagicMock()
        device = self.make_device(
            {
                "friendly_name": "Kitchen speaker",
                "cast_uuid": "b5628c48-7e75-ed5a-b2ac-0bf79184bbeb",
                "cast_model_name": "Google Nest Mini",
            }
        )
        driver = GoogleCastDriver(device)

        with patch(
            "pychromecast.get_chromecast_from_host",
            return_value=cast,
        ) as factory, patch(
            "pychromecast.get_chromecasts"
        ) as discover:
            result = driver._cast()

        self.assertIs(result, cast)
        discover.assert_not_called()
        host = factory.call_args.args[0]
        self.assertEqual(host[0], "192.168.1.68")
        self.assertEqual(host[1], 8009)
        self.assertEqual(
            host[2],
            UUID("b5628c48-7e75-ed5a-b2ac-0bf79184bbeb"),
        )
        self.assertEqual(host[3], "Google Nest Mini")
        self.assertEqual(host[4], "Kitchen speaker")
        cast.wait.assert_called_once_with(timeout=5)

    def test_cast_operation_always_disconnects_worker_thread(self):
        cast = MagicMock()
        driver = GoogleCastDriver(self.make_device())

        with patch.object(driver, "_cast", return_value=cast):
            result = driver._with_cast(lambda _: "ok")

        self.assertEqual(result, "ok")
        cast.disconnect.assert_called_once_with(timeout=2)

    def test_cast_operation_disconnects_after_operation_error(self):
        cast = MagicMock()
        driver = GoogleCastDriver(self.make_device())

        with patch.object(driver, "_cast", return_value=cast):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                driver._with_cast(
                    lambda _: (_ for _ in ()).throw(RuntimeError("boom"))
                )

        cast.disconnect.assert_called_once_with(timeout=2)

    def test_invalid_or_missing_discovery_uuid_gets_stable_fallback(self):
        driver = GoogleCastDriver(
            self.make_device(
                {
                    "friendly_name": "Kitchen speaker",
                    "cast_uuid": "not-a-uuid",
                }
            )
        )

        first = driver._cast_uuid()
        second = driver._cast_uuid()

        self.assertIsInstance(first, UUID)
        self.assertEqual(first, second)
