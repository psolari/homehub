from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)

from django.urls import path
from rest_framework import routers
from .views import (
    DeviceViewSet,
    DeviceTypesView,
    FloorPlanViewSet,
    RoomViewSet,
    UserViewSet,
)

router = routers.DefaultRouter()
router.register(r"users", UserViewSet, basename="user")
router.register(r"floorplans", FloorPlanViewSet, basename="floorplan")
router.register(r"rooms", RoomViewSet, basename="room")
router.register(r"devices", DeviceViewSet, basename="device")

urlpatterns = [
    path("token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("device-types/", DeviceTypesView.as_view(), name="device_types"),
]

urlpatterns += router.urls
