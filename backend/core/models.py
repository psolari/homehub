from django.db import models
from django.contrib.auth.models import AbstractUser


# Create your models here.
class User(AbstractUser):
    description = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.username


class FloorPlan(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    svg_data = models.TextField()

    def __str__(self):
        return self.name


class Room(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    floor_plan = models.ForeignKey(
        FloorPlan, related_name="rooms", on_delete=models.CASCADE
    )

    def __str__(self):
        return self.name


class Device(models.Model):
    STATUS_CHOICES = [
        ("off", "Off"),
        ("on", "On"),
        ("idle", "Idle"),
        ("error", "Error"),
        ("running", "Running"),
    ]

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    room = models.ForeignKey(
        Room, related_name="devices", on_delete=models.CASCADE, null=True, blank=True
    )
    static_ip = models.BooleanField(
        default=False, help_text="Is the device using a static IP address?"
    )
    ip_address = models.GenericIPAddressField(
        protocol="both", unpack_ipv4=True, blank=True, null=True
    )
    mac_address = models.CharField(max_length=17, blank=True, null=True)
    device_type = models.CharField(max_length=50)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="off")
    floorplan_object_id = models.CharField(max_length=100, blank=True, null=True)
    config = models.JSONField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)

    hidden_fields = [
        "mac_address",
        "device_type",
        "status",
        "floorplan_object_id",
        "config",
        "metadata",
        "room",
        "id",
    ]

    def __str__(self):
        return self.name
