from __future__ import annotations
from typing import Any
from homehub.core.models import Device
from homehub.core.services.crypto import decrypt_json, encrypt_json


def _secret_fields(device_type: str, model: str | None) -> set[str]:
    from homehub.core.integrations.registry import get_driver
    try:
        driver = get_driver(device_type, model)
    except Exception:
        return set()
    return {str(field["name"]) for field in driver.config_schema if field.get("secret") and field.get("name")}


def split_driver_config(device_type: str, model: str | None, config: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
    values = dict(config or {})
    secret_fields = _secret_fields(device_type, model)
    return ({k: v for k, v in values.items() if k not in secret_fields}, {k: v for k, v in values.items() if k in secret_fields})


def get_device_credentials(device: Device) -> dict[str, Any]:
    return decrypt_json(device.encrypted_credentials)


def set_device_credentials(device: Device, credentials: dict[str, Any], *, merge: bool = True, save: bool = True) -> dict[str, Any]:
    current = get_device_credentials(device) if merge and device.encrypted_credentials else {}
    current.update({k: v for k, v in credentials.items() if v is not None and v != ""})
    device.encrypted_credentials = encrypt_json(current) if current else ""
    if save:
        device.save(update_fields=["encrypted_credentials"])
    return current


def sanitized_config(device: Device) -> dict[str, Any]:
    public, _ = split_driver_config(device.device_type, device.model, device.config or {})
    return public
