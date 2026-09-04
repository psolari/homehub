from django.db import models
from django.utils import timezone


class Device(models.Model):
    STATUS_CHOICES = [
        ("off", "Off"),
        ("on", "On"),
        ("idle", "Idle"),
        ("error", "Error"),
        ("running", "Running"),
        ("unknown", "Unknown"),
    ]
    DEVICE_TYPES_CHOICES = [
        ("light", "Light"),
        ("switch", "Switch"),
        ("sensor", "Sensor"),
        ("thermostat", "Thermostat"),
        ("camera", "Camera"),
        ("tv", "TV"),
        ("speaker", "Speaker"),
        ("vacuum", "Vacuum"),
        ("security", "Security"),
        ("appliance", "Appliance"),
    ]
    SOURCE_CHOICES = [
        ("manual", "Manual"),
        ("discovery", "Discovery"),
        ("cloud", "Cloud"),
    ]

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    room = models.ForeignKey(
        "core.Room", related_name="devices", on_delete=models.CASCADE, null=True, blank=True
    )
    static_ip = models.BooleanField(default=False, help_text="Is the device using a static IP address?")
    ip_address = models.GenericIPAddressField(protocol="both", unpack_ipv4=True, blank=True, null=True)
    mac_address = models.CharField(max_length=17, blank=True, null=True)
    device_type = models.CharField(max_length=20, choices=DEVICE_TYPES_CHOICES)
    model = models.CharField(max_length=100, blank=True, null=True)
    manufacturer = models.CharField(max_length=100, blank=True, default="")
    hardware_model = models.CharField(max_length=150, blank=True, default="")
    unique_id = models.CharField(max_length=255, blank=True, null=True, unique=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="manual")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="unknown")
    floorplan_object_id = models.CharField(max_length=100, blank=True, null=True)
    config = models.JSONField(blank=True, null=True)
    encrypted_credentials = models.TextField(blank=True, default="")
    metadata = models.JSONField(blank=True, null=True)
    capabilities = models.JSONField(default=dict, blank=True)
    state = models.JSONField(default=dict, blank=True)
    discovery_data = models.JSONField(default=dict, blank=True)
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(blank=True, null=True)

    hidden_fields = [
        "mac_address", "status", "floorplan_object_id", "config", "metadata",
        "capabilities", "state", "discovery_data", "last_seen", "is_online", "id",
    ]

    def mark_seen(self) -> None:
        self.is_online = True
        self.last_seen = timezone.now()

    def __str__(self) -> str:
        return self.name


class DashboardGroup(models.Model):
    name = models.CharField(max_length=100)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return self.name


class DashboardCard(models.Model):
    SIZE_CHOICES = [("small", "Small"), ("medium", "Medium"), ("large", "Large")]
    device = models.OneToOneField(Device, related_name="dashboard_card", on_delete=models.CASCADE)
    group = models.ForeignKey(
        DashboardGroup,
        related_name="cards",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    enabled = models.BooleanField(default=True)
    size = models.CharField(max_length=10, choices=SIZE_CHOICES, default="medium")
    order = models.PositiveIntegerField(default=0)
    visible_controls = models.JSONField(default=list, blank=True)
    grid_x = models.PositiveSmallIntegerField(default=0)
    grid_y = models.PositiveSmallIntegerField(default=0)
    grid_w = models.PositiveSmallIntegerField(default=4)
    grid_h = models.PositiveSmallIntegerField(default=3)

    class Meta:
        ordering = ["group_id", "grid_y", "grid_x", "order", "id"]


class IntegrationAccount(models.Model):
    PROVIDERS = [
        ("spotify", "Spotify"), ("hive", "Hive"), ("ring", "Ring"),
        ("alexa", "Amazon Alexa"), ("ring_alarm_mqtt", "Ring Alarm MQTT"),
    ]
    STATUS_CHOICES = [
        ("disconnected", "Disconnected"), ("connected", "Connected"),
        ("needs_auth", "Needs authentication"), ("error", "Error"),
    ]
    provider = models.CharField(max_length=30, choices=PROVIDERS)
    name = models.CharField(max_length=100)
    encrypted_credentials = models.TextField(blank=True, default="")
    config = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="disconnected")
    error = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["provider", "name"]
        constraints = [
            models.UniqueConstraint(fields=["provider", "name"], name="unique_homehub_integration_account")
        ]

    def __str__(self) -> str:
        return f"{self.get_provider_display()}: {self.name}"


class DeviceLocation(models.Model):
    device = models.ForeignKey(Device, related_name="location_history", on_delete=models.CASCADE)
    floor_plan = models.ForeignKey(
        "core.FloorPlan", related_name="device_locations", on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    x = models.FloatField()
    y = models.FloatField()
    heading = models.FloatField(default=0)
    source = models.CharField(max_length=40, default="device")
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]
