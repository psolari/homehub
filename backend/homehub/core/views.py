from django.shortcuts import render
from rest_framework import viewsets
from rest_framework.metadata import SimpleMetadata
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.decorators import api_view
from rest_framework import status

from homehub.core.models import Device, FloorPlan, Room, User
from homehub.core.serializers import (
    DeviceSerializer,
    FloorPlanSerializer,
    RoomSerializer,
    UserSerializer,
)
from homehub.core.device_modules.device_schema import device_schema
from homehub.core.device_modules.tv import get_tv_driver


class CustomMetaData(SimpleMetadata):
    def determine_metadata(self, request, view):
        metadata = super().determine_metadata(request, view)

        model = None
        if hasattr(view, "get_serializer"):
            serializer = view.get_serializer()
            model = getattr(serializer.Meta, "model", None)

        if model and hasattr(model, "hidden_fields"):
            hidden_fields = set(model.hidden_fields)

            # Add a "hidden" flag to each field's metadata
            actions = metadata.get("actions", {})
            for method, fields in actions.items():
                for field_name in fields:
                    fields[field_name]["hidden"] = field_name in hidden_fields

        return metadata


# Create your views here.
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer


class FloorPlanViewSet(viewsets.ModelViewSet):
    queryset = FloorPlan.objects.all()
    serializer_class = FloorPlanSerializer


class RoomViewSet(viewsets.ModelViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer


class DeviceViewSet(viewsets.ModelViewSet):
    queryset = Device.objects.all()
    serializer_class = DeviceSerializer
    metadata_class = CustomMetaData

    def create(self, request, *args, **kwargs):
        print("hello world")
        device_type = request.data.get("device_type")
        model = request.data.get("model")
        device = request.data
        if device_type == "tv":
            driver_class = get_tv_driver(model)
            driver = driver_class(device)  # instantiate it
            success, conn_response = driver.initialize_connection()  # call init
        if success:
            response = super().create(request, *args, **kwargs)
        else:
            return Response(
                {
                    "status": "error",
                    "message": "Failed to connect to device",
                    "details": conn_response,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return response


class DeviceTypesView(APIView):
    def get(self, request):
        result = device_schema
        return Response(result)


@api_view(["POST"])
def samsung_power_toggle(request):
    tv_name = request.data.get("name")
    command = request.data.get("command")
    if not tv_name:
        return Response(
            {"error": "TV name is required"}, status=status.HTTP_400_BAD_REQUEST
        )
    if not command:
        return Response(
            {"error": "Command is required"}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        tv = Device.objects.get(name=tv_name)
    except Device.DoesNotExist:
        return Response(
            {"error": f"TV with name '{tv_name}' does not exist."},
            status=status.HTTP_404_NOT_FOUND,
        )
    driver = get_tv_driver(tv.model)
    tv_driver = driver(tv)
    tv_func = getattr(tv_driver, command, None)
    if not tv_func:
        return Response(
            {"error": f"Command '{command}' is not supported for this TV."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    tv_func()
    return Response(
        {"status": "success", "command": command, "tv": tv_name},
        status=status.HTTP_200_OK,
    )
