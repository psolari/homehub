from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from homehub.core.integrations import get_driver_catalog
from homehub.core.integrations.music.spotify import SpotifyService
from homehub.core.integrations.providers import PROVIDER_SCHEMAS
from homehub.core.models import DashboardCard, Device, FloorPlan, FloorPlanObject, IntegrationAccount, Room, User
from homehub.core.serializers import DashboardCardSerializer, DeviceLocationSerializer, DeviceSerializer, FloorPlanObjectSerializer, FloorPlanSerializer, IntegrationAccountSerializer, RoomSerializer, UserSerializer
from homehub.core.services.devices import create_device, driver_for, execute_control, refresh_device, run_async
from homehub.core.services.discovery import discover_all


class OpenViewSet(viewsets.ModelViewSet): permission_classes=[AllowAny]
class UserViewSet(OpenViewSet): queryset=User.objects.all().order_by("id"); serializer_class=UserSerializer
class RoomViewSet(OpenViewSet): queryset=Room.objects.all().order_by("floor_plan_id","name"); serializer_class=RoomSerializer
class FloorPlanViewSet(OpenViewSet): queryset=FloorPlan.objects.prefetch_related("objects__device").all().order_by("id"); serializer_class=FloorPlanSerializer
class FloorPlanObjectViewSet(OpenViewSet):
    queryset=FloorPlanObject.objects.select_related("device","floor_plan").all(); serializer_class=FloorPlanObjectSerializer
    def get_queryset(self):
        qs=super().get_queryset(); floor_plan=self.request.query_params.get("floor_plan"); return qs.filter(floor_plan_id=floor_plan) if floor_plan else qs
class DashboardCardViewSet(OpenViewSet): queryset=DashboardCard.objects.select_related("device").all(); serializer_class=DashboardCardSerializer


class DeviceViewSet(OpenViewSet):
    queryset=Device.objects.select_related("room").prefetch_related("location_history").all().order_by("name"); serializer_class=DeviceSerializer
    def create(self,request,*args,**kwargs):
        serializer=self.get_serializer(data=request.data); serializer.is_valid(raise_exception=True); device=create_device(dict(serializer.validated_data),validate_connection=bool(request.data.get("validate_connection",True))); return Response(self.get_serializer(device).data,status=status.HTTP_201_CREATED)
    @action(detail=False,methods=["post"],url_path="add-discovered")
    def add_discovered(self,request):
        payload=dict(request.data); payload.setdefault("source","discovery"); serializer=self.get_serializer(data=payload); serializer.is_valid(raise_exception=True); device=create_device(dict(serializer.validated_data),validate_connection=True); return Response(self.get_serializer(device).data,status=status.HTTP_201_CREATED)
    @action(detail=True,methods=["post","get"])
    def refresh(self,request,pk=None):
        device=self.get_object(); state_data=refresh_device(device); return Response({"device":self.get_serializer(device).data,"state":state_data})
    @action(detail=True,methods=["post"])
    def control(self,request,pk=None):
        action_name=request.data.get("action")
        if not action_name:return Response({"error":"action is required"},status=status.HTTP_400_BAD_REQUEST)
        try:return Response(execute_control(self.get_object(),action_name,request.data.get("parameters") or {}))
        except Exception as exc:return Response({"error":str(exc)},status=status.HTTP_400_BAD_REQUEST)
    @action(detail=True,methods=["get"],url_path="camera-frame")
    def camera_frame(self,request,pk=None):
        try:frame=run_async(driver_for(self.get_object()).camera_frame())
        except Exception as exc:return Response({"error":str(exc)},status=status.HTTP_502_BAD_GATEWAY)
        if not frame:return Response({"error":"No camera frame is available"},status=status.HTTP_404_NOT_FOUND)
        data,content_type=frame; response=HttpResponse(data,content_type=content_type); response["Cache-Control"]="no-store"; return response
    @action(detail=True,methods=["get"],url_path="locations")
    def locations(self,request,pk=None):return Response(DeviceLocationSerializer(self.get_object().location_history.all()[:500],many=True).data)


class DiscoveryView(APIView):
    permission_classes=[AllowAny]
    def post(self,request):
        try:return Response(discover_all(request.data.get("cidr"),include_cloud=request.data.get("include_cloud",True)))
        except ValueError as exc:return Response({"error":str(exc)},status=status.HTTP_400_BAD_REQUEST)
class DeviceCatalogView(APIView): permission_classes=[AllowAny]; get=lambda self,request: Response(get_driver_catalog())
class ProviderCatalogView(APIView): permission_classes=[AllowAny]; get=lambda self,request: Response(PROVIDER_SCHEMAS)


class IntegrationAccountViewSet(OpenViewSet):
    queryset=IntegrationAccount.objects.all(); serializer_class=IntegrationAccountSerializer
    @action(detail=True,methods=["post"])
    def connect(self,request,pk=None):
        account=self.get_object()
        if account.provider=="spotify":
            try:url=SpotifyService(account).authorization_url(state=str(account.id))
            except Exception as exc: account.status,account.error="error",str(exc); account.save(update_fields=["status","error"]); return Response({"error":str(exc)},status=400)
            account.status,account.error="needs_auth",""; account.save(update_fields=["status","error"]); return Response({"authorization_url":url})
        account.status,account.error="connected",""; account.save(update_fields=["status","error"]); return Response(self.get_serializer(account).data)
    @action(detail=True,methods=["get"],url_path="spotify-search")
    def spotify_search(self,request,pk=None):
        q=request.query_params.get("q","").strip()
        if not q:return Response([])
        try:return Response(SpotifyService(self.get_object()).search(q))
        except Exception as exc:return Response({"error":str(exc)},status=400)
    @action(detail=True,methods=["get"],url_path="spotify-devices")
    def spotify_devices(self,request,pk=None):
        try:return Response(SpotifyService(self.get_object()).devices())
        except Exception as exc:return Response({"error":str(exc)},status=400)


@api_view(["GET"])
@permission_classes([AllowAny])
def spotify_callback(request):
    account=get_object_or_404(IntegrationAccount,pk=request.query_params.get("state"),provider="spotify")
    if request.query_params.get("error"):return HttpResponse(f"Spotify authorization failed: {request.query_params['error']}",status=400)
    code=request.query_params.get("code")
    if not code:return HttpResponse("Spotify did not return an authorization code.",status=400)
    try:SpotifyService(account).exchange_code(code)
    except Exception as exc:return HttpResponse(f"Spotify authorization failed: {exc}",status=400)
    return HttpResponse("Spotify connected to HomeHub. You can close this tab.")

@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):return Response({"status":"ok","service":"homehub"})
