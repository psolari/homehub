import os
from .base import *  # noqa: F403,F401
from .base import env_bool
DEBUG=env_bool("DJANGO_DEBUG",True)
if os.getenv("DJANGO_ALLOWED_HOSTS") is None: ALLOWED_HOSTS=["*"]  # noqa: F405
CORS_ALLOW_ALL_ORIGINS=env_bool("DJANGO_CORS_ALLOW_ALL_ORIGINS",True)
