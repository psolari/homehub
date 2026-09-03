from django.urls import include, path
from rest_framework import routers
from homehub.core.views import DashboardCardViewSet, DeviceCatalogView, DeviceViewSet, DiscoveryView, FloorPlanObjectViewSet, FloorPlanViewSet, IntegrationAccountViewSet, ProviderCatalogView, RoomViewSet, UserViewSet, health, spotify_callback

router=routers.DefaultRouter()
router.register(r"users",UserViewSet,basename="user"); router.register(r"floor-plans",FloorPlanViewSet,basename="floor-plan"); router.register(r"floor-plan-objects",FloorPlanObjectViewSet,basename="floor-plan-object"); router.register(r"rooms",RoomViewSet,basename="room"); router.register(r"devices",DeviceViewSet,basename="device"); router.register(r"dashboard-cards",DashboardCardViewSet,basename="dashboard-card"); router.register(r"integration-accounts",IntegrationAccountViewSet,basename="integration-account")
urlpatterns=[path("health/",health,name="health"),path("device-catalog/",DeviceCatalogView.as_view(),name="device-catalog"),path("provider-catalog/",ProviderCatalogView.as_view(),name="provider-catalog"),path("discovery/",DiscoveryView.as_view(),name="discovery"),path("integration-accounts/spotify-callback/",spotify_callback,name="spotify-callback"),path("",include(router.urls))]
