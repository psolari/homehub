from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from homehub.core.models import Device
from homehub.core.services.ring_live import RingLiveViewManager, _LiveSession


class RingLiveViewManagerMessageTests(TestCase):
    def test_message_buffer_returns_cursor_and_only_new_messages(self):
        manager = RingLiveViewManager()
        session = _LiveSession(
            session_id="session-1",
            device_id=1,
            ring=SimpleNamespace(),
            ring_device=SimpleNamespace(),
        )
        manager._sessions["session-1"] = session

        manager._append_message("session-1", {"type": "answer", "sdp": "v=0"})
        manager._append_message(
            "session-1",
            {
                "type": "candidate",
                "candidate": "candidate:1",
                "sdp_m_line_index": 0,
            },
        )

        first = manager.messages("session-1", after=0)
        second = manager.messages("session-1", after=1)

        self.assertEqual(first["cursor"], 2)
        self.assertEqual([item["type"] for item in first["messages"]], ["answer", "candidate"])
        self.assertEqual([item["seq"] for item in second["messages"]], [2])


class RingLiveViewApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.device = Device.objects.create(
            name="Front Door",
            device_type="camera",
            model="ring_camera",
            manufacturer="Ring",
            source="cloud",
            status="on",
            config={
                "account_id": 1,
                "ring_device_id": "front-door",
                "family": "doorbots",
            },
            state={"camera_available": True},
        )

    @patch("homehub.core.views.ring_live_view_manager")
    def test_live_view_config_exposes_webrtc_features(self, manager):
        manager.ice_servers.return_value = [{"urls": "stun:example.test:3478"}]

        response = self.client.get(
            f"/api/v1/devices/{self.device.id}/live-view/config/"
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["supported"])
        self.assertTrue(response.data["audio_receive"])
        self.assertTrue(response.data["talkback"])
        self.assertEqual(
            response.data["ice_servers"],
            [{"urls": "stun:example.test:3478"}],
        )

    @patch("homehub.core.views.ring_live_view_manager")
    def test_live_view_start_passes_browser_offer_to_manager(self, manager):
        manager.start.return_value = {
            "session_id": "session-1",
            "ice_servers": [],
        }

        response = self.client.post(
            f"/api/v1/devices/{self.device.id}/live-view/start/",
            {
                "session_id": "session-1",
                "offer": "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        manager.start.assert_called_once_with(
            self.device,
            session_id="session-1",
            sdp_offer="v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
        )

    @patch("homehub.core.views.ring_live_view_manager")
    def test_live_view_candidate_and_messages_are_forwarded(self, manager):
        manager.messages.return_value = {
            "session_id": "session-1",
            "cursor": 3,
            "messages": [{"seq": 3, "type": "answer", "sdp": "v=0"}],
        }

        candidate_response = self.client.post(
            f"/api/v1/devices/{self.device.id}/live-view/candidate/",
            {
                "session_id": "session-1",
                "candidate": "candidate:1",
                "sdp_m_line_index": 1,
            },
            format="json",
        )
        messages_response = self.client.get(
            f"/api/v1/devices/{self.device.id}/live-view/messages/"
            "?session_id=session-1&after=2"
        )

        self.assertEqual(candidate_response.status_code, 200)
        manager.candidate.assert_called_once_with(
            "session-1",
            candidate="candidate:1",
            sdp_m_line_index=1,
        )
        self.assertEqual(messages_response.status_code, 200)
        self.assertEqual(messages_response.data["cursor"], 3)
        manager.messages.assert_called_once_with("session-1", after=2)

    @patch("homehub.core.views.ring_live_view_manager")
    def test_live_view_stop_is_idempotent_at_api_boundary(self, manager):
        response = self.client.post(
            f"/api/v1/devices/{self.device.id}/live-view/stop/",
            {"session_id": "session-1"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        manager.stop.assert_called_once_with("session-1")
