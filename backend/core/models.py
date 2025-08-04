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
    device_type = models.CharField(max_length=50)  # e.g., 'light', 'thermostat', etc.
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="off")
    floorplan_object_id = models.CharField(max_length=100, blank=True, null=True)
    credentials = models.JSONField(
        blank=True, null=True
    )  # Store device credentials as JSON
    config_schema = models.JSONField(
        blank=True, null=True
    )  # Store device configuration schema as JSON
    metadata = models.JSONField(
        blank=True, null=True
    )  # Store additional metadata as JSON

    def __str__(self):
        return self.name
