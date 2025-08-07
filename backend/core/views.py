from django.shortcuts import render
from rest_framework import viewsets
from rest_framework.metadata import SimpleMetadata
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Device, FloorPlan, Room, User
from .serializers import (
    DeviceSerializer,
    FloorPlanSerializer,
    RoomSerializer,
    UserSerializer,
)
from .device_modules.device_schema import device_schema


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


class DeviceTypesView(APIView):
    def get(self, request):
        result = [{"type": key, **data} for key, data in device_schema.items()]
        return Response(result)
