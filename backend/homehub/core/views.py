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
    Device,
    FloorPlan,
    FloorPlanObject,
    IntegrationAccount,
    Room,
    User,
)
from homehub.core.serializers import (
    DashboardCardSerializer,
    DeviceLocationSerializer,
    DeviceSerializer,
    FloorPlanObjectSerializer,
    FloorPlanSerializer,
    IntegrationAccountSerializer,
    RoomSerializer,
    UserSerializer,
)
from homehub.core.services.accounts import get_credentials
from homehub.core.services.device_config import get_device_credentials
from homehub.core.services.integration_accounts import validate_integration_account
from homehub.core.services.devices import (
    create_device,
    driver_for,
    execute_control,
    initialize_device,
    refresh_device,
    run_async,
    validate_setup_payload,
)
from homehub.core.services.discovery import discover_account, discover_all


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


class DashboardCardViewSet(OpenViewSet):
    queryset = DashboardCard.objects.select_related("device").all()
    serializer_class = DashboardCardSerializer


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

    @action(detail=True, methods=["get"], url_path="camera-frame")
    def camera_frame(self, request, pk=None):
        try:
            frame = run_async(driver_for(self.get_object()).camera_frame())
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        if not frame:
            return Response(
                {"error": "No camera frame is available"}, status=status.HTTP_404_NOT_FOUND
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


class DeviceCatalogView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(get_driver_catalog())


class ProviderCatalogView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(PROVIDER_SCHEMAS)


class IntegrationAccountViewSet(OpenViewSet):
    queryset = IntegrationAccount.objects.all()
    serializer_class = IntegrationAccountSerializer

    @action(detail=True, methods=["post"])
    def connect(self, request, pk=None):
        account = self.get_object()
        try:
            if account.provider == "spotify":
                credentials = get_credentials(account)
                if credentials.get("token_info"):
                    devices = SpotifyService(account).devices()
                    account.status, account.error = "connected", ""
                    account.metadata = {
                        **(account.metadata or {}),
                        "verified_at": timezone.now().isoformat(),
                        "provider_devices_seen": len(devices or []),
                    }
                    account.save(update_fields=["status", "error", "metadata"])
                    data = self.get_serializer(account).data
                    data["connection"] = {
                        "message": "Spotify authorization verified.",
                        "provider_devices_seen": len(devices or []),
                    }
                    return Response(data)

                url = SpotifyService(account).authorization_url(state=str(account.id))
                account.status, account.error = "needs_auth", ""
                account.save(update_fields=["status", "error"])
                data = self.get_serializer(account).data
                data["authorization_url"] = url
                return Response(data)

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
            return Response(SpotifyService(self.get_object()).search(query))
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
