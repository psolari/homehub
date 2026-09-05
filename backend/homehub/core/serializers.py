from rest_framework import serializers

from homehub.core.models import (
    DashboardCard,
    DashboardGroup,
    Device,
    DeviceLocation,
    FloorPlan,
    FloorPlanObject,
    IntegrationAccount,
    Room,
    User,
)
from homehub.core.services.accounts import get_credentials, set_credentials
from homehub.core.services.device_config import (
    get_device_credentials,
    sanitized_config,
    set_device_credentials,
    split_driver_config,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "description"]


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = "__all__"


class FloorPlanObjectSerializer(serializers.ModelSerializer):
    device_state = serializers.SerializerMethodField()
    device_capabilities = serializers.SerializerMethodField()

    class Meta:
        model = FloorPlanObject
        fields = "__all__"

    def get_device_state(self, obj):
        return obj.device.state if obj.device_id else None

    def get_device_capabilities(self, obj):
        return obj.device.capabilities if obj.device_id else None


class FloorPlanSerializer(serializers.ModelSerializer):
    rooms = RoomSerializer(many=True, read_only=True)
    objects = FloorPlanObjectSerializer(
        source="floorplan_objects",
        many=True,
        read_only=True,
    )

    class Meta:
        model = FloorPlan
        fields = ["id", "name", "description", "svg_data", "width", "height", "rooms", "objects"]


class DashboardGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = DashboardGroup
        fields = ["id", "name", "order"]


class DashboardCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = DashboardCard
        fields = [
            "id",
            "device",
            "group",
            "enabled",
            "size",
            "order",
            "visible_controls",
            "grid_x",
            "grid_y",
            "grid_w",
            "grid_h",
        ]


class DeviceLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceLocation
        fields = ["id", "device", "floor_plan", "x", "y", "heading", "source", "recorded_at"]


class DeviceSerializer(serializers.ModelSerializer):
    dashboard_card = DashboardCardSerializer(read_only=True)
    latest_location = serializers.SerializerMethodField()
    configured_credentials = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = [
            "id",
            "name",
            "description",
            "room",
            "static_ip",
            "ip_address",
            "mac_address",
            "device_type",
            "model",
            "manufacturer",
            "hardware_model",
            "unique_id",
            "source",
            "status",
            "config",
            "metadata",
            "capabilities",
            "state",
            "discovery_data",
            "is_online",
            "last_seen",
            "dashboard_card",
            "latest_location",
            "configured_credentials",
        ]
        read_only_fields = [
            "status",
            "capabilities",
            "state",
            "is_online",
            "last_seen",
            "configured_credentials",
        ]

    def get_latest_location(self, obj):
        location = obj.location_history.first()
        return DeviceLocationSerializer(location).data if location else None

    def get_configured_credentials(self, obj):
        try:
            return sorted(get_device_credentials(obj).keys()) if obj.encrypted_credentials else []
        except Exception:
            return []

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["config"] = sanitized_config(instance)
        return data

    def update(self, instance, validated_data):
        supplied = validated_data.pop("config", None)
        if supplied is not None:
            public, secrets = split_driver_config(
                str(validated_data.get("device_type", instance.device_type)),
                validated_data.get("model", instance.model),
                supplied,
            )
            validated_data["config"] = public
            if secrets:
                set_device_credentials(instance, secrets)
        return super().update(instance, validated_data)


class IntegrationAccountSerializer(serializers.ModelSerializer):
    credentials = serializers.DictField(write_only=True, required=False)
    configured_credentials = serializers.SerializerMethodField()

    class Meta:
        model = IntegrationAccount
        fields = [
            "id",
            "provider",
            "name",
            "config",
            "metadata",
            "status",
            "error",
            "active",
            "credentials",
            "configured_credentials",
        ]
        read_only_fields = ["status", "error", "configured_credentials"]

    def get_configured_credentials(self, obj):
        try:
            return sorted(get_credentials(obj).keys())
        except Exception:
            return []

    def create(self, validated_data):
        credentials = validated_data.pop("credentials", {})
        account = super().create(validated_data)
        if credentials:
            set_credentials(account, credentials)
        return account

    def update(self, instance, validated_data):
        credentials = validated_data.pop("credentials", None)
        account = super().update(instance, validated_data)
        if credentials:
            set_credentials(account, credentials)
            account.status = "disconnected"
            account.error = ""
            account.save(update_fields=["status", "error"])
        return account
