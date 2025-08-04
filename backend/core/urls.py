from rest_framework import routers
from .views import (
    DeviceViewSet,
    FloorPlanViewSet,
    RoomViewSet,
    UserViewSet,
)

router = routers.DefaultRouter()
router.register(r"users", UserViewSet, basename="user")
router.register(r"floorplans", FloorPlanViewSet, basename="floorplan")
router.register(r"rooms", RoomViewSet, basename="room")
router.register(r"devices", DeviceViewSet, basename="device")

urlpatterns = router.urls
