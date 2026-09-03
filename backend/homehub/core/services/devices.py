from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from django.db import transaction
from django.utils import timezone
from homehub.core.integrations.base import IntegrationError
from homehub.core.integrations.registry import get_driver
from homehub.core.models import DashboardCard, Device, DeviceLocation
from homehub.core.services.device_config import set_device_credentials, split_driver_config


def run_async(awaitable):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(awaitable)).result()


def driver_for(device: Device):
    return get_driver(device.device_type, device.model)(device)


def _normalise_status(state: dict[str, Any]) -> str:
    value = str(state.get("status") or "unknown").lower()
    if value in dict(Device.STATUS_CHOICES):
        return value
    power = str(state.get("power") or "").lower()
    return power if power in {"on", "off"} else "unknown"


def persist_state(device: Device, state: dict[str, Any]) -> Device:
    state = state or {}
    device.state = state
    device.is_online = bool(state.get("online", True))
    device.status = _normalise_status(state)
    if device.is_online:
        device.last_seen = timezone.now()
    device.save(update_fields=["state", "is_online", "status", "last_seen"])
    location = state.get("location")
    if isinstance(location, dict) and location.get("x") is not None and location.get("y") is not None:
        obj = device.floorplan_objects.select_related("floor_plan").first()
        DeviceLocation.objects.create(device=device, floor_plan=obj.floor_plan if obj else None, x=float(location["x"]), y=float(location["y"]), heading=float(location.get("heading") or 0), source=str(location.get("source") or "device"))
    return device


def refresh_device(device: Device, *, raise_errors: bool = False) -> dict[str, Any]:
    try:
        driver = driver_for(device)
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])
        state = run_async(driver.get_state())
        persist_state(device, state)
        return state
    except Exception as exc:
        state = {"online": False, "status": "error", "error": str(exc)}
        persist_state(device, state)
        if raise_errors:
            raise
        return state


def execute_control(device: Device, action: str, parameters: dict[str, Any] | None = None):
    driver = driver_for(device)
    allowed = {item["action"] for item in driver.capabilities().get("controls", [])}
    if action not in allowed:
        raise IntegrationError(f"Action '{action}' is not advertised by this device.")
    result = run_async(driver.execute(action, parameters or {}))
    return {"result": result, "state": refresh_device(device)}


@transaction.atomic
def create_device(validated_data: dict[str, Any], *, validate_connection: bool = True) -> Device:
    payload = dict(validated_data)
    supplied_config = payload.pop("config", {}) or {}
    public_config, secret_config = split_driver_config(str(payload.get("device_type") or "appliance"), payload.get("model"), supplied_config)
    payload["config"] = public_config
    device = Device.objects.create(**payload)
    if secret_config:
        set_device_credentials(device, secret_config)
    try:
        driver = driver_for(device)
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])
        if validate_connection:
            persist_state(device, run_async(driver.initialize()))
    except Exception as exc:
        device.state = {"online": False, "status": "error", "error": str(exc)}
        device.status = "error"
        device.is_online = False
        device.save(update_fields=["state", "status", "is_online"])
    DashboardCard.objects.get_or_create(device=device, defaults={"visible_controls": [c["action"] for c in (device.capabilities or {}).get("controls", [])[:4]]})
    return device
