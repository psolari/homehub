from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

from django.conf import settings


def _fernet():
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise RuntimeError("cryptography is required; install backend/requirements-integrations.txt") from exc
    configured = os.getenv("HOMEHUB_ENCRYPTION_KEY", "").strip()
    key = configured.encode() if configured else base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt_json(value: dict[str, Any]) -> str:
    return _fernet().encrypt(json.dumps(value, separators=(",", ":")).encode()).decode()


def decrypt_json(value: str) -> dict[str, Any]:
    if not value:
        return {}
    return json.loads(_fernet().decrypt(value.encode()).decode())
