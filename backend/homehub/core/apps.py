from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "homehub.core"

    def ready(self):
        import homehub.core.integrations  # noqa: F401
