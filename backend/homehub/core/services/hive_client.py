from __future__ import annotations

import asyncio
from typing import Any


class HiveClientError(RuntimeError):
    pass


def exception_message(exc: BaseException, fallback: str) -> str:
    message = str(exc).strip()
    return message or f"{fallback} ({exc.__class__.__name__})"


async def open_hive_session(credentials: dict[str, Any]):
    """Authenticate and create a Hive session using pyhive-integration >=1.0.9."""
    username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "")
    if not username or not password:
        raise HiveClientError("Hive email and password are required.")

    from apyhiveapi import Auth, Hive

    auth = Auth(username=username, password=password)
    try:
        tokens = await asyncio.wait_for(auth.login(), timeout=25)
    except TimeoutError as exc:
        raise HiveClientError(
            "Hive login timed out after 25 seconds while contacting Hive authentication. "
            "Check internet access from the HomeHub backend and try again."
        ) from exc
    except Exception as exc:
        if exc.__class__.__name__ in {"HiveSmsRequired", "HiveReauthRequired"}:
            raise HiveClientError(
                "Hive accepted the account details but requires additional authentication. "
                "If Hive sent you an SMS code, HomeHub needs that code to complete setup."
            ) from exc
        raise HiveClientError(
            exception_message(exc, "Hive authentication failed")
        ) from exc

    if not tokens:
        raise HiveClientError("Hive login completed but did not return authentication tokens.")

    try:
        hive = Hive(username=username, password=password)
        await asyncio.wait_for(
            hive.startSession({"tokens": tokens}),
            timeout=35,
        )
    except TimeoutError as exc:
        raise HiveClientError(
            "Hive authenticated, but loading the Hive account/devices timed out after 35 seconds. "
            "The Hive service may be slow; try again shortly."
        ) from exc
    except Exception as exc:
        raise HiveClientError(
            exception_message(exc, "Hive session setup failed")
        ) from exc

    return hive


def hive_devices(hive) -> list[Any]:
    data = getattr(getattr(hive, "session", None), "data", None)
    devices = getattr(data, "devices", None) or {}
    if isinstance(devices, dict):
        return list(devices.values())
    return list(devices or [])


def hive_value(device, *names: str, default=None):
    for name in names:
        if isinstance(device, dict) and name in device:
            return device.get(name)
        if hasattr(device, name):
            return getattr(device, name)
    return default


def hive_device_identity(device) -> str:
    value = hive_value(
        device,
        "id",
        "device_id",
        "deviceId",
        "deviceID",
        "uuid",
        default="",
    )
    return str(value or "")


def hive_device_name(device) -> str:
    value = hive_value(
        device,
        "name",
        "device_name",
        "deviceName",
        "display_name",
        default="Hive Heating",
    )
    return str(value or "Hive Heating")


def hive_device_descriptor(device) -> str:
    fields = [
        hive_value(device, "type", default=""),
        hive_value(device, "device_type", "deviceType", default=""),
        hive_value(device, "hiveType", "hive_type", default=""),
        hive_value(device, "product_type", "productType", default=""),
        hive_value(device, "model", "model_name", default=""),
        device.__class__.__name__,
    ]
    return " ".join(str(value or "") for value in fields).casefold()


def is_hive_heating_device(device) -> bool:
    descriptor = hive_device_descriptor(device)
    if any(
        token in descriptor
        for token in (
            "heating",
            "thermostat",
            "thermostatic",
            "trv",
            "radiator",
            "climate",
            "zone",
        )
    ):
        return True

    # Some pyhive device objects do not populate a human-readable type but do
    # expose the heating fields directly.
    heating_fields = (
        "current_temperature",
        "currentTemperature",
        "target_temperature",
        "targetTemperature",
        "heating_mode",
        "heatingMode",
    )
    return any(hive_value(device, field, default=None) is not None for field in heating_fields)
