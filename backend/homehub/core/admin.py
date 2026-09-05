from django.contrib import admin
from homehub.core.models import DashboardCard, Device, DeviceLocation, FloorPlan, FloorPlanObject, IntegrationAccount, Room, User

for model in (User, FloorPlan, Room, Device, FloorPlanObject, DashboardCard, DeviceLocation, IntegrationAccount):
    try:
        admin.site.register(model)
    except admin.sites.AlreadyRegistered:
        pass
