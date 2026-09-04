from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from homehub.core.integrations import get_driver_catalog
from homehub.core.integrations.music.spotify import SpotifyService
from homehub.core.integrations.providers import PROVIDER_SCHEMAS
from homehub.core.integrations.registry import get_driver
from homehub.core.models import (
    DashboardCard,
    DashboardGroup,
    Device,
    FloorPlan,
    FloorPlanObject,
    IntegrationAccount,
    Room,
    User,
)
from homehub.core.serializers import (
    DashboardCardSerializer,
    DashboardGroupSerializer,
    DeviceLocationSerializer,
    DeviceSerializer,
    FloorPlanObjectSerializer,
    FloorPlanSerializer,
    IntegrationAccountSerializer,
    RoomSerializer,
    UserSerializer,
)
from homehub.core.services.accounts import get_active_account, get_credentials
from homehub.core.services.device_config import get_device_credentials
from homehub.core.services.integration_accounts import validate_integration_account
from homehub.core.services.ring_live import ring_live_view_manager
from homehub.core.services.devices import (
    create_device,
    driver_for,
    execute_control,
    initialize_device,
    refresh_device,
    run_async,
    validate_setup_payload,
)
from homehub.core.services.discovery import (
    discover_account,
    discover_all,
    discover_cloud_accounts,
)


class OpenViewSet(viewsets.ModelViewSet):
    permission_classes = [AllowAny]


class UserViewSet(OpenViewSet):
    queryset = User.objects.all().order_by("id")
    serializer_class = UserSerializer


class RoomViewSet(OpenViewSet):
    queryset = Room.objects.all().order_by("floor_plan_id", "name")
    serializer_class = RoomSerializer


class FloorPlanViewSet(OpenViewSet):
    queryset = FloorPlan.objects.prefetch_related("floorplan_objects__device").all().order_by("id")
    serializer_class = FloorPlanSerializer


class FloorPlanObjectViewSet(OpenViewSet):
    queryset = FloorPlanObject.objects.select_related("device", "floor_plan").all()
    serializer_class = FloorPlanObjectSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        floor_plan = self.request.query_params.get("floor_plan")
        return queryset.filter(floor_plan_id=floor_plan) if floor_plan else queryset


class DashboardGroupViewSet(OpenViewSet):
    queryset = DashboardGroup.objects.all().order_by("order", "id")
    serializer_class = DashboardGroupSerializer


class DashboardCardViewSet(OpenViewSet):
    queryset = DashboardCard.objects.select_related("device", "group").all()
    serializer_class = DashboardCardSerializer

    @action(detail=False, methods=["post"], url_path="layout")
    def layout(self, request):
        updates = request.data.get("cards") or []
        if not isinstance(updates, list):
            return Response(
                {"error": "cards must be a list"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cards = {
            card.id: card
            for card in DashboardCard.objects.select_related("group").all()
        }

        proposed = {}
        for card in cards.values():
            proposed[card.id] = {
                "id": card.id,
                "group": card.group_id,
                "grid_x": card.grid_x,
                "grid_y": card.grid_y,
                "grid_w": card.grid_w,
                "grid_h": card.grid_h,
            }

        for item in updates:
            try:
                card_id = int(item["id"])
            except (KeyError, TypeError, ValueError):
                return Response(
                    {"error": "Every layout update requires a valid card id."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if card_id not in cards:
                return Response(
                    {"error": f"Dashboard card {card_id} was not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            current = proposed[card_id]
            for key in ("grid_x", "grid_y", "grid_w", "grid_h"):
                if key in item:
                    try:
                        current[key] = int(item[key])
                    except (TypeError, ValueError):
                        return Response(
                            {"error": f"{key} must be an integer."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
            if "group" in item:
                group = item.get("group")
                current["group"] = int(group) if group not in (None, "") else None

        for card in proposed.values():
            if (
                card["grid_x"] < 0
                or card["grid_y"] < 0
                or card["grid_w"] < 2
                or card["grid_h"] < 2
                or card["grid_x"] + card["grid_w"] > 12
            ):
                return Response(
                    {
                        "error": (
                            f"Card {card['id']} has an invalid dashboard grid position or size."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        by_group = {}
        for card in proposed.values():
            by_group.setdefault(card["group"], []).append(card)

        for group_cards in by_group.values():
            for index, left in enumerate(group_cards):
                for right in group_cards[index + 1 :]:
                    overlaps = not (
                        left["grid_x"] + left["grid_w"] <= right["grid_x"]
                        or right["grid_x"] + right["grid_w"] <= left["grid_x"]
                        or left["grid_y"] + left["grid_h"] <= right["grid_y"]
                        or right["grid_y"] + right["grid_h"] <= left["grid_y"]
                    )
                    if overlaps:
                        return Response(
                            {
                                "error": (
                                    f"Dashboard cards {left['id']} and {right['id']} overlap."
                                )
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

        changed_ids = {int(item["id"]) for item in updates}
        with transaction.atomic():
            for card_id in changed_ids:
                card = cards[card_id]
                next_card = proposed[card_id]
                card.group_id = next_card["group"]
                card.grid_x = next_card["grid_x"]
                card.grid_y = next_card["grid_y"]
                card.grid_w = next_card["grid_w"]
                card.grid_h = next_card["grid_h"]
                card.save(
                    update_fields=[
                        "group",
                        "grid_x",
                        "grid_y",
                        "grid_w",
                        "grid_h",
                    ]
                )

        saved = DashboardCard.objects.select_related("device", "group").filter(
            id__in=changed_ids
        )
        return Response({"cards": DashboardCardSerializer(saved, many=True).data})


class DeviceViewSet(OpenViewSet):
    queryset = (
        Device.objects.select_related("room")
        .prefetch_related("location_history")
        .all()
        .order_by("name")
    )
    serializer_class = DeviceSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            device = create_device(
                dict(serializer.validated_data),
                validate_connection=bool(request.data.get("validate_connection", True)),
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(device).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="complete-setup")
    def complete_setup(self, request):
        """Validate, pair/authenticate and create a device as one transaction."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            device = create_device(
                dict(serializer.validated_data),
                validate_connection=bool(request.data.get("validate_connection", True)),
                require_success=True,
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"device": self.get_serializer(device).data, "state": device.state},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="setup-action")
    def setup_action(self, request):
        """Run a safe driver-specific onboarding helper before device creation."""
        device_type = str(request.data.get("device_type") or "")
        model = str(request.data.get("model") or "")
        action_name = str(request.data.get("action") or "")
        if not device_type or not model or not action_name:
            return Response(
                {"error": "device_type, model and action are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            driver_class = get_driver(device_type, model)
            result = run_async(
                driver_class.run_setup_action(
                    action_name,
                    device_data=dict(request.data.get("device") or {}),
                    config=dict(request.data.get("config") or {}),
                    parameters=dict(request.data.get("parameters") or {}),
                )
            )
            return Response(result)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["post"], url_path="add-discovered")
    def add_discovered(self, request):
        # Retained for API compatibility. The React UI now uses complete-setup
        # so discovered devices cannot bypass their integration wizard.
        payload = dict(request.data)
        payload.setdefault("source", "discovery")
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        try:
            device = create_device(
                dict(serializer.validated_data),
                validate_connection=True,
                require_success=True,
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(device).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="setup")
    def setup_existing(self, request, pk=None):
        """Finish/retry onboarding for a device that already exists."""
        device = self.get_object()
        incoming = dict(request.data)
        incoming_config = dict(incoming.pop("config", {}) or {})
        merged_public_config = {**(device.config or {}), **incoming_config}
        incoming["config"] = merged_public_config

        serializer = self.get_serializer(device, data=incoming, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            device = serializer.save()
            full_config = {**(device.config or {})}
            if device.encrypted_credentials:
                full_config.update(get_device_credentials(device))
            validate_setup_payload(
                {
                    "device_type": device.device_type,
                    "model": device.model,
                    "ip_address": device.ip_address,
                    "mac_address": device.mac_address,
                    "config": full_config,
                }
            )
            state_data = initialize_device(device, raise_errors=True)
        except Exception as exc:
            return Response(
                {"error": str(exc), "device": self.get_serializer(device).data},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"device": self.get_serializer(device).data, "state": state_data})

    @action(detail=True, methods=["post", "get"])
    def refresh(self, request, pk=None):
        device = self.get_object()
        state_data = refresh_device(device)
        return Response({"device": self.get_serializer(device).data, "state": state_data})

    @action(detail=True, methods=["post"])
    def control(self, request, pk=None):
        action_name = request.data.get("action")
        if not action_name:
            return Response({"error": "action is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response(
                execute_control(
                    self.get_object(),
                    action_name,
                    request.data.get("parameters") or {},
                )
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="live-view/config")
    def live_view_config(self, request, pk=None):
        device = self.get_object()
        if device.model != "ring_camera":
            return Response(
                {"error": "Live View is currently available for Ring cameras only."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "supported": True,
                "ice_servers": ring_live_view_manager.ice_servers(),
                "audio_receive": True,
                "talkback": True,
            }
        )

    @action(detail=True, methods=["post"], url_path="live-view/start")
    def live_view_start(self, request, pk=None):
        device = self.get_object()
        try:
            result = ring_live_view_manager.start(
                device,
                session_id=str(request.data.get("session_id") or ""),
                sdp_offer=str(request.data.get("offer") or ""),
            )
            return Response(result)
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=["post"], url_path="live-view/candidate")
    def live_view_candidate(self, request, pk=None):
        self.get_object()
        try:
            ring_live_view_manager.candidate(
                str(request.data.get("session_id") or ""),
                candidate=str(request.data.get("candidate") or ""),
                sdp_m_line_index=int(request.data.get("sdp_m_line_index") or 0),
            )
            return Response({"ok": True})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=["get"], url_path="live-view/messages")
    def live_view_messages(self, request, pk=None):
        self.get_object()
        try:
            return Response(
                ring_live_view_manager.messages(
                    str(request.query_params.get("session_id") or ""),
                    after=int(request.query_params.get("after") or 0),
                )
            )
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=True, methods=["post"], url_path="live-view/stop")
    def live_view_stop(self, request, pk=None):
        self.get_object()
        try:
            ring_live_view_manager.stop(
                str(request.data.get("session_id") or "")
            )
            return Response({"ok": True})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=["get"], url_path="camera-frame")
    def camera_frame(self, request, pk=None):
        try:
            frame = run_async(driver_for(self.get_object()).camera_frame())
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        if not frame:
            return Response(
                {"error": "The camera did not return an image."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        data, content_type = frame
        response = HttpResponse(data, content_type=content_type)
        response["Cache-Control"] = "no-store"
        return response

    @action(detail=True, methods=["get"], url_path="locations")
    def locations(self, request, pk=None):
        return Response(
            DeviceLocationSerializer(self.get_object().location_history.all()[:500], many=True).data
        )


class DiscoveryView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            return Response(
                discover_all(
                    request.data.get("cidr"),
                    include_cloud=request.data.get("include_cloud", True),
                )
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class CloudDiscoveryView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            return Response({"devices": discover_cloud_accounts()})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )


class DeviceCatalogView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(get_driver_catalog())


class ProviderCatalogView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(PROVIDER_SCHEMAS)


class SpotifyPlayerViewSet(viewsets.ViewSet):
    permission_classes = [AllowAny]

    @staticmethod
    def _account():
        return get_active_account("spotify")

    @staticmethod
    def _normalise_name(value):
        return "".join(character for character in str(value or "").casefold() if character.isalnum())

    def _service(self):
        account = self._account()
        if account.status != "connected":
            raise RuntimeError("Spotify is not connected. Configure Spotify in Integrations first.")
        service = SpotifyService(account)
        missing = service.missing_scopes()
        if missing:
            account.status = "needs_auth"
            account.error = (
                "Spotify needs to be re-authorised for the full HomeHub player. "
                "Missing permissions: " + ", ".join(missing)
            )
            account.save(update_fields=["status", "error"])
            raise RuntimeError(account.error)
        return service

    def _outputs(self, service):
        spotify_devices = service.devices()
        homehub_speakers = list(Device.objects.filter(device_type="speaker").order_by("name"))
        matched_homehub: set[int] = set()
        outputs = []

        for item in spotify_devices:
            spotify_name = str(item.get("name") or "Spotify device")
            spotify_id = item.get("id")
            matched = None
            for speaker in homehub_speakers:
                config = speaker.config or {}
                configured_id = str(config.get("spotify_device_id") or "")
                configured_name = str(
                    config.get("spotify_device_name")
                    or speaker.name
                    or ""
                )
                if configured_id and spotify_id and configured_id == str(spotify_id):
                    matched = speaker
                    break
                if self._normalise_name(configured_name) == self._normalise_name(spotify_name):
                    matched = speaker
                    break

            if matched:
                matched_homehub.add(matched.id)

            outputs.append(
                {
                    "spotify_device_id": spotify_id,
                    "name": spotify_name,
                    "type": item.get("type"),
                    "is_active": bool(item.get("is_active")),
                    "is_restricted": bool(item.get("is_restricted")),
                    "volume_percent": item.get("volume_percent"),
                    "supports_volume": bool(item.get("supports_volume")),
                    "available": bool(spotify_id) and not bool(item.get("is_restricted")),
                    "homehub_device_id": matched.id if matched else None,
                    "homehub_name": matched.name if matched else None,
                    "homehub_model": matched.model if matched else None,
                }
            )

        for speaker in homehub_speakers:
            if speaker.id in matched_homehub:
                continue
            outputs.append(
                {
                    "spotify_device_id": None,
                    "name": speaker.name,
                    "type": "speaker",
                    "is_active": False,
                    "is_restricted": False,
                    "volume_percent": speaker.state.get("volume") if speaker.state else None,
                    "supports_volume": False,
                    "available": False,
                    "homehub_device_id": speaker.id,
                    "homehub_name": speaker.name,
                    "homehub_model": speaker.model,
                    "unavailable_reason": "This HomeHub speaker is not currently exposed by Spotify Connect.",
                }
            )

        return outputs

    @action(detail=False, methods=["get"])
    def home(self, request):
        try:
            service = self._service()
            data = service.home()
            data["outputs"] = self._outputs(service)
            return Response(data)
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["get"])
    def playback(self, request):
        try:
            service = self._service()
            return Response(
                {
                    "playback": service.playback(),
                    "queue": service.queue(),
                    "outputs": self._outputs(service),
                }
            )
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["get"])
    def search(self, request):
        query = str(request.query_params.get("q") or "").strip()
        if not query:
            return Response(
                {
                    "tracks": [],
                    "albums": [],
                    "playlists": [],
                    "shows": [],
                    "episodes": [],
                }
            )
        try:
            return Response(self._service().search_grouped(query))
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["get"], url_path="show-episodes")
    def show_episodes(self, request):
        show_id = str(request.query_params.get("show_id") or "").strip()
        if not show_id:
            return Response(
                {"error": "show_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            return Response({"episodes": self._service().show_episodes(show_id)})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["post"])
    def play(self, request):
        try:
            service = self._service()
            service.play(
                request.data.get("uri"),
                device_id=request.data.get("device_id"),
            )
            return Response({"playback": service.playback()})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["post"])
    def control(self, request):
        action_name = str(request.data.get("action") or "")
        device_id = request.data.get("device_id")
        try:
            service = self._service()
            if action_name == "resume":
                service.play(device_id=device_id)
            elif action_name == "pause":
                service.pause(device_id=device_id)
            elif action_name == "next":
                service.next(device_id=device_id)
            elif action_name == "previous":
                service.previous(device_id=device_id)
            elif action_name == "shuffle":
                service.set_shuffle(bool(request.data.get("value")), device_id=device_id)
            elif action_name == "repeat":
                service.set_repeat(str(request.data.get("value") or "off"), device_id=device_id)
            elif action_name == "seek":
                service.seek(int(request.data.get("position_ms") or 0), device_id=device_id)
            elif action_name == "queue":
                uri = str(request.data.get("uri") or "")
                if not uri:
                    raise RuntimeError("A Spotify URI is required to add an item to the queue.")
                service.add_to_queue(uri, device_id=device_id)
            else:
                raise RuntimeError(f"Unknown Spotify player action: {action_name}")
            return Response({"playback": service.playback(), "queue": service.queue()})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        device_id = str(request.data.get("device_id") or "")
        if not device_id:
            return Response(
                {"error": "device_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            service = self._service()
            service.transfer(device_id, play=bool(request.data.get("play", True)))
            return Response({"playback": service.playback(), "outputs": self._outputs(service)})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=["post"])
    def volume(self, request):
        try:
            service = self._service()
            service.set_volume(
                int(request.data.get("value") or 0),
                device_id=request.data.get("device_id"),
            )
            return Response({"playback": service.playback()})
        except Exception as exc:
            return Response(
                {"error": str(exc) or exc.__class__.__name__},
                status=status.HTTP_400_BAD_REQUEST,
            )


class IntegrationAccountViewSet(OpenViewSet):
    queryset = IntegrationAccount.objects.all()
    serializer_class = IntegrationAccountSerializer

    @action(detail=True, methods=["post"])
    def connect(self, request, pk=None):
        account = self.get_object()
        try:
            if account.provider == "spotify":
                credentials = get_credentials(account)
                service = SpotifyService(account)
                token_info = credentials.get("token_info")
                if token_info and not service.missing_scopes():
                    devices = service.devices()
                    account.status, account.error = "connected", ""
                    account.metadata = {
                        **(account.metadata or {}),
                        "verified_at": timezone.now().isoformat(),
                        "provider_devices_seen": len(devices or []),
                        "spotify_scopes": sorted(service.token_scopes()),
                    }
                    account.save(update_fields=["status", "error", "metadata"])
                    data = self.get_serializer(account).data
                    data["connection"] = {
                        "message": "Spotify authorization verified.",
                        "provider_devices_seen": len(devices or []),
                    }
                    return Response(data)

                url = service.authorization_url(state=str(account.id))
                account.status, account.error = "needs_auth", ""
                account.save(update_fields=["status", "error"])
                data = self.get_serializer(account).data
                data["authorization_url"] = url
                if token_info:
                    data["connection"] = {
                        "message": "Spotify needs additional permissions for the full HomeHub player.",
                        "missing_scopes": service.missing_scopes(),
                    }
                return Response(data)

            # Hive and Ring discovery already authenticates and opens the
            # provider session. Re-running a separate validation first doubles
            # cloud login/API work and can leave the UI waiting on two slow
            # sessions. Use one discovery pass as both verification and discovery.
            if account.provider in {"hive", "ring"}:
                discovered = discover_account(account)
                connection = {
                    "message": f"{account.get_provider_display()} account authenticated successfully.",
                    "provider_devices_seen": len(discovered),
                    "verified_at": timezone.now().isoformat(),
                }
            else:
                connection = validate_integration_account(account)
                discovered = discover_account(account)

            account.status, account.error = "connected", ""
            account.metadata = {
                **(account.metadata or {}),
                **connection,
                "discovered_devices_count": len(discovered),
            }
            account.save(update_fields=["status", "error", "metadata"])
            data = self.get_serializer(account).data
            data["connection"] = connection
            data["discovered_devices"] = discovered
            return Response(data)
        except Exception as exc:
            account.status, account.error = "error", str(exc)
            account.save(update_fields=["status", "error"])
            return Response(
                {"error": str(exc), "account": self.get_serializer(account).data},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=["post"])
    def discover(self, request, pk=None):
        account = self.get_object()
        if account.status != "connected":
            return Response(
                {"error": "Verify this integration before discovering devices."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            devices = discover_account(account)
            account.metadata = {
                **(account.metadata or {}),
                "discovered_devices_count": len(devices),
                "last_discovered_at": timezone.now().isoformat(),
            }
            account.save(update_fields=["metadata"])
            return Response({"devices": devices, "count": len(devices)})
        except Exception as exc:
            account.status, account.error = "error", str(exc)
            account.save(update_fields=["status", "error"])
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="spotify-search")
    def spotify_search(self, request, pk=None):
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response([])
        try:
            return Response(SpotifyService(self.get_object()).search_grouped(query))
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="spotify-devices")
    def spotify_devices(self, request, pk=None):
        try:
            return Response(SpotifyService(self.get_object()).devices())
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@permission_classes([AllowAny])
def spotify_callback(request):
    account = get_object_or_404(
        IntegrationAccount,
        pk=request.query_params.get("state"),
        provider="spotify",
    )
    if request.query_params.get("error"):
        return HttpResponse(
            f"Spotify authorization failed: {request.query_params['error']}",
            status=400,
        )
    code = request.query_params.get("code")
    if not code:
        return HttpResponse("Spotify did not return an authorization code.", status=400)
    try:
        SpotifyService(account).exchange_code(code)
    except Exception as exc:
        return HttpResponse(f"Spotify authorization failed: {exc}", status=400)
    return HttpResponse("Spotify connected to HomeHub. You can close this tab.")


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "homehub"})
