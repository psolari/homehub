import os

_environment=os.getenv("HOMEHUB_ENV","development").lower()
if _environment=="production":
    from .production import *  # noqa: F403,F401
else:
    from .development import *  # noqa: F403,F401
