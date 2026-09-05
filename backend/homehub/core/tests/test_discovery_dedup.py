from django.test import TestCase

from homehub.core.models import Device
from homehub.core.services.discovery import (
    Candidate,
    _dedupe_candidates,
    _is_already_configured,
)


class DiscoveryDeduplicationTests(TestCase):
    def test_native_discovery_wins_over_tcp_probe_for_same_device(self):
        tcp = Candidate(
            unique_id="google_cast:192.168.1.68",
            name="Google Cast device (192.168.1.68)",
            device_type="speaker",
            model="google_cast",
            manufacturer="Google",
            ip_address="192.168.1.68",
            discovery_data={"method": "tcp_probe", "port": 8009},
        )
        native = Candidate(
            unique_id="cast:living-room-uuid",
            name="Kitchen speaker",
            device_type="speaker",
            model="google_cast",
            manufacturer="Google",
            hardware_model="Google Nest Audio",
            ip_address="192.168.1.68",
            discovery_data={"method": "mdns", "uuid": "living-room-uuid"},
        )

        result = _dedupe_candidates([tcp, native])

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].unique_id, "cast:living-room-uuid")
        self.assertEqual(result[0].name, "Kitchen speaker")
        self.assertEqual(result[0].hardware_model, "Google Nest Audio")

    def test_configured_device_is_filtered_even_when_unique_id_differs(self):
        Device.objects.create(
            name="Living Room",
            device_type="speaker",
            model="sonos",
            ip_address="192.168.1.181",
            unique_id="sonos:RINCON_ABC",
        )
        probe = Candidate(
            unique_id="sonos:192.168.1.181",
            name="Sonos Speaker (192.168.1.181)",
            device_type="speaker",
            model="sonos",
            ip_address="192.168.1.181",
            discovery_data={"method": "tcp_probe", "port": 1400},
        )

        self.assertTrue(_is_already_configured(probe))
