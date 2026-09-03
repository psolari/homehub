from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = BASE_DIR.parents[1]


def load_environment_file(path: Path) -> None:
    """Load a simple dotenv file without overriding real process environment variables.

    HomeHub keeps its development `.env` at the repository root while Django is
    normally launched from `backend/`. Loading it here makes Django management
    commands behave consistently in new terminals, VS Code and other local
    development entry points without requiring `source .env` first.

    Production/container environment variables always win because values are
    installed with ``os.environ.setdefault``.
    """
    if not path.is_file():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()

        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        os.environ.setdefault(key, value)


load_environment_file(REPOSITORY_ROOT / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError(
        "DJANGO_SECRET_KEY is required. Copy .env.example to .env and set a local secret."
    )

DEBUG = False
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "homehub.core",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "homehub.smart_home_backend.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "homehub.smart_home_backend.wsgi.application"
ASGI_APPLICATION = "homehub.smart_home_backend.asgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
AUTH_USER_MODEL = "core.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
REST_FRAMEWORK = {"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"]}
LANGUAGE_CODE = "en-gb"
TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "Europe/London")
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CORS_ALLOWED_ORIGINS = env_list("DJANGO_CORS_ALLOWED_ORIGINS", "http://localhost:5173")
CORS_ALLOW_ALL_ORIGINS = env_bool("DJANGO_CORS_ALLOW_ALL_ORIGINS", False)
HOMEHUB_RUNTIME_DIR = Path(os.getenv("HOMEHUB_RUNTIME_DIR", BASE_DIR / ".runtime"))
HOMEHUB_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
