from types import SimpleNamespace

from django.test import SimpleTestCase

from homehub.core.integrations.music.spotify import SpotifyService


class FakeSpotify:
    def __init__(self):
        self.calls = []

    def search(self, **kwargs):
        self.calls.append(("search", kwargs))
        return {
            "tracks": {
                "items": [
                    {
                        "id": "track-1",
                        "uri": "spotify:track:track-1",
                        "type": "track",
                        "name": "A Song",
                        "artists": [{"name": "Artist"}],
                        "album": {
                            "images": [{"url": "https://img/album.jpg"}],
                            "artists": [{"name": "Artist"}],
                        },
                    }
                ]
            },
            "albums": {"items": []},
            "playlists": {"items": []},
            "shows": {"items": []},
            "episodes": {"items": []},
        }

    def start_playback(self, **kwargs):
        self.calls.append(("start_playback", kwargs))

    def transfer_playback(self, device_id, force_play=False):
        self.calls.append(
            (
                "transfer_playback",
                {"device_id": device_id, "force_play": force_play},
            )
        )


class SpotifyServiceTests(SimpleTestCase):
    def service_with_client(self):
        fake = FakeSpotify()
        service = object.__new__(SpotifyService)
        service.account = SimpleNamespace()
        service.credentials = {}
        service.client = lambda: fake
        service.resolve_device = lambda *, device_id=None, device_name=None: device_id
        return service, fake

    def test_search_returns_playable_grouped_track(self):
        service, _ = self.service_with_client()

        result = service.search_grouped("song")

        self.assertEqual(result["tracks"][0]["uri"], "spotify:track:track-1")
        self.assertEqual(result["tracks"][0]["subtitle"], "Artist")
        self.assertEqual(result["tracks"][0]["image"], "https://img/album.jpg")

    def test_play_uses_uri_list_for_track_and_context_for_playlist(self):
        service, fake = self.service_with_client()

        service.play("spotify:track:track-1", device_id="speaker-1")
        service.play("spotify:playlist:playlist-1", device_id="speaker-1")

        self.assertEqual(
            fake.calls[0],
            (
                "start_playback",
                {
                    "uris": ["spotify:track:track-1"],
                    "device_id": "speaker-1",
                },
            ),
        )
        self.assertEqual(
            fake.calls[1],
            (
                "start_playback",
                {
                    "context_uri": "spotify:playlist:playlist-1",
                    "device_id": "speaker-1",
                },
            ),
        )

    def test_radio_and_mixes_selects_personalised_playlist_names(self):
        service = object.__new__(SpotifyService)
        playlists = [
            {"name": "Daily Mix 1", "uri": "spotify:playlist:1"},
            {"name": "My cooking playlist", "uri": "spotify:playlist:2"},
            {"name": "Release Radar", "uri": "spotify:playlist:3"},
            {"name": "Artist Radio", "uri": "spotify:playlist:4"},
        ]

        result = service.radio_and_mixes(playlists)

        self.assertEqual(
            [item["name"] for item in result],
            ["Daily Mix 1", "Release Radar", "Artist Radio"],
        )

    def test_transfer_targets_spotify_connect_device(self):
        service, fake = self.service_with_client()

        service.transfer("living-room", play=True)

        self.assertEqual(
            fake.calls[-1],
            (
                "transfer_playback",
                {"device_id": "living-room", "force_play": True},
            ),
        )
