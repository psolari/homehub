from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from homehub.core.integrations.base import IntegrationError
from homehub.core.integrations.registry import get_driver
from homehub.core.models import DashboardCard, Device, DeviceLocation
from homehub.core.services.device_config import set_device_credentials, split_driver_config
from homehub.core.services.network import resolve_mac_address


REFRESH_FAILURE_THRESHOLD = 3
REFRESH_FAILURE_GRACE = timedelta(seconds=45)
_REFRESH_HEALTH_KEYS = {
    "_refresh_failures",
    "_refresh_error",
    "_refresh_degraded",
}


def run_async(awaitable):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(awaitable)).result()


def driver_for(device: Device):
    return get_driver(device.device_type, device.model)(device)


def _persist_driver_credentials(driver) -> None:
    updates = driver.consume_credential_updates()
    if updates:
        set_device_credentials(driver.device, updates)


def _ensure_device_mac(device: Device) -> None:
    if device.mac_address or not device.ip_address:
        return
    mac = resolve_mac_address(str(device.ip_address))
    if mac:
        device.mac_address = mac
        device.save(update_fields=["mac_address"])


def _next_dashboard_slot(
    *,
    width: int = 4,
    height: int = 3,
    group_id: int | None = None,
) -> tuple[int, int]:
    cards = list(
        DashboardCard.objects.filter(group_id=group_id).values(
            "grid_x",
            "grid_y",
            "grid_w",
            "grid_h",
        )
    )

    for y in range(200):
        for x in range(0, 12 - width + 1):
            overlaps = any(
                not (
                    x + width <= card["grid_x"]
                    or card["grid_x"] + card["grid_w"] <= x
                    or y + height <= card["grid_y"]
                    or card["grid_y"] + card["grid_h"] <= y
                )
                for card in cards
            )
            if not overlaps:
                return x, y

    return 0, max(
        (card["grid_y"] + card["grid_h"] for card in cards),
        default=0,
    )


def _normalise_status(state: dict[str, Any]) -> str:
    value = str(state.get("status") or "unknown").lower()
    if value in dict(Device.STATUS_CHOICES):
        return value
    power = str(state.get("power") or "").lower()
    return power if power in {"on", "off"} else "unknown"


def validate_setup_payload(payload: dict[str, Any]) -> type:
    device_type = str(payload.get("device_type") or "appliance")
    model = payload.get("model") or "generic"
    driver_class = get_driver(device_type, model)
    config = dict(payload.get("config") or {})
    setup = driver_class.catalog_entry().get("setup") or {}

    if setup.get("requires_ip") and not payload.get("ip_address"):
        raise IntegrationError(f"{driver_class.display_name} requires an IP address.")
    if setup.get("requires_mac") and not (payload.get("mac_address") or config.get("mac_address")):
        raise IntegrationError(f"{driver_class.display_name} requires a MAC address.")

    missing = []
    for field in driver_class.config_schema:
        if not field.get("required"):
            continue
        value = config.get(field.get("name"))
        if value is None or value == "":
            missing.append(field.get("label") or field.get("name"))
    if missing:
        raise IntegrationError(f"Complete the required setup fields: {', '.join(str(item) for item in missing)}.")
    return driver_class


def _clear_refresh_health(state: dict[str, Any]) -> dict[str, Any]:
    clean = dict(state or {})
    for key in _REFRESH_HEALTH_KEYS:
        clean.pop(key, None)
    return clean


def persist_refresh_failure(device: Device, exc: Exception) -> dict[str, Any]:
    """Keep a last-known-good state through short integration/network blips."""
    previous = dict(device.state or {})
    try:
        failures = int(previous.get("_refresh_failures") or 0) + 1
    except (TypeError, ValueError):
        failures = 1

    previous["_refresh_failures"] = failures
    previous["_refresh_error"] = str(exc) or exc.__class__.__name__
    previous["_refresh_degraded"] = True

    now = timezone.now()
    within_grace = bool(
        device.last_seen
        and now - device.last_seen <= REFRESH_FAILURE_GRACE
    )
    hard_failure = failures >= REFRESH_FAILURE_THRESHOLD and not within_grace

    if hard_failure:
        previous["online"] = False
        previous["status"] = "error"
        previous["error"] = previous["_refresh_error"]
        device.state = previous
        device.is_online = False
        device.status = "error"
        device.save(update_fields=["state", "is_online", "status"])
        return previous

    # A single slow response should not make a healthy device flash red/offline.
    previous["online"] = device.is_online
    previous["status"] = device.status
    if device.status != "error":
        previous.pop("error", None)
    device.state = previous
    device.save(update_fields=["state"])
    return previous


def persist_state(device: Device, state: dict[str, Any]) -> Device:
    state = _clear_refresh_health(state or {})
    device.state = state
    device.is_online = bool(state.get("online", True))
    device.status = _normalise_status(state)
    if device.is_online:
        device.last_seen = timezone.now()
    device.save(update_fields=["state", "is_online", "status", "last_seen"])
    location = state.get("location")
    if (
        isinstance(location, dict)
        and location.get("x") is not None
        and location.get("y") is not None
        and location.get("source") != "roomba_mqtt"
    ):
        obj = device.floorplan_objects.select_related("floor_plan").first()
        DeviceLocation.objects.create(
            device=device,
            floor_plan=obj.floor_plan if obj else None,
            x=float(location["x"]),
            y=float(location["y"]),
            heading=float(location.get("heading") or 0),
            source=str(location.get("source") or "device"),
        )
    return device


def initialize_device(device: Device, *, raise_errors: bool = True) -> dict[str, Any]:
    try:
        _ensure_device_mac(device)
        driver = driver_for(device)
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])
        try:
            state = run_async(driver.initialize())
        finally:
            _persist_driver_credentials(driver)
        if not isinstance(state, dict):
            state = {"online": True, "status": "unknown"}
        if state.get("online") is False:
            raise IntegrationError(str(state.get("error") or "Device connection test failed."))

        # Some integrations (notably Ring) learn hardware capabilities from
        # the live device state. Recompute capabilities from that fresh state
        # before returning the device to the frontend.
        driver.device.state = state
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])

        persist_state(device, state)
        return state
    except Exception as exc:
        state = {"online": False, "status": "error", "error": str(exc)}
        persist_state(device, state)
        if raise_errors:
            raise
        return state


def refresh_device(device: Device, *, raise_errors: bool = False) -> dict[str, Any]:
    try:
        _ensure_device_mac(device)
        driver = driver_for(device)
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])
        try:
            state = run_async(driver.get_state())
        finally:
            _persist_driver_credentials(driver)
        driver.device.state = state
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])
        persist_state(device, state)
        return state
    except Exception as exc:
        state = persist_refresh_failure(device, exc)
        if raise_errors:
            raise
        return state


def execute_control(device: Device, action: str, parameters: dict[str, Any] | None = None):
    driver = driver_for(device)
    allowed = {item["action"] for item in driver.capabilities().get("controls", [])}
    if action not in allowed:
        raise IntegrationError(f"Action '{action}' is not advertised by this device.")
    try:
        result = run_async(driver.execute(action, parameters or {}))
    finally:
        _persist_driver_credentials(driver)
    return {"result": result, "state": refresh_device(device)}


@transaction.atomic
def create_device(
    validated_data: dict[str, Any],
    *,
    validate_connection: bool = True,
    require_success: bool = False,
) -> Device:
    payload = dict(validated_data)
    supplied_config = payload.pop("config", {}) or {}
    if payload.get("ip_address") and not payload.get("mac_address"):
        payload["mac_address"] = resolve_mac_address(str(payload["ip_address"]))
    validation_payload = {**payload, "config": supplied_config}
    validate_setup_payload(validation_payload)

    public_config, secret_config = split_driver_config(
        str(payload.get("device_type") or "appliance"),
        payload.get("model"),
        supplied_config,
    )
    payload["config"] = public_config
    device = Device.objects.create(**payload)
    if secret_config:
        set_device_credentials(device, secret_config)

    try:
        driver = driver_for(device)
        device.capabilities = driver.capabilities()
        device.save(update_fields=["capabilities"])
        if validate_connection:
            initialize_device(device, raise_errors=True)
    except Exception as exc:
        if require_success:
            # Mark this transaction for rollback by re-raising. The setup wizard
            # receives the actual pairing/authentication error and no broken
            # device is left in the database.
            raise IntegrationError(str(exc)) from exc
        device.state = {"online": False, "status": "error", "error": str(exc)}
        device.status = "error"
        device.is_online = False
        device.save(update_fields=["state", "status", "is_online"])

    grid_x, grid_y = _next_dashboard_slot()
    DashboardCard.objects.get_or_create(
        device=device,
        defaults={
            "visible_controls": [
                control["action"]
                for control in (device.capabilities or {}).get("controls", [])[:4]
            ],
            "grid_x": grid_x,
            "grid_y": grid_y,
            "grid_w": 4,
            "grid_h": 3,
        },
    )
    return device
