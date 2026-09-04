from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class RingClientError(RuntimeError):
    pass


def exception_message(exc: BaseException, fallback: str) -> str:
    return str(exc).strip() or f"{fallback} ({exc.__class__.__name__})"


async def open_ring_session(credentials: dict[str, Any]):
    """Open a Ring session and return (ring, refreshed_token)."""
    from ring_doorbell import Auth, Ring
    from ring_doorbell.exceptions import Requires2FAError

    username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "")
    token_update: dict[str, Any] = {}

    def token_updated(token):
        token_update["token"] = token

    auth = Auth("HomeHub/1.0", credentials.get("token"), token_updated)
    try:
        if not credentials.get("token"):
            if not username or not password:
                raise RingClientError("Ring email and password are required.")
            await auth.async_fetch_token(
                username,
                password,
                credentials.get("otp"),
            )
        ring = Ring(auth)
        await ring.async_create_session()
        await ring.async_update_data()
    except Requires2FAError as exc:
        raise RingClientError(
            "Ring requires a fresh two-factor authentication code. Enter the code from Ring and try again."
        ) from exc
    except RingClientError:
        raise
    except Exception as exc:
        raise RingClientError(
            exception_message(exc, "Ring connection failed")
        ) from exc

    return ring, token_update.get("token")


def ring_device_groups(ring) -> dict[str, list[Any]]:
    """Normalise python-ring-doorbell's RingDevices container."""
    devices = ring.devices()

    if isinstance(devices, Mapping):
        return {
            str(family): list(values or [])
            for family, values in devices.items()
        }

    groups: dict[str, list[Any]] = {}
    for family in (
        "doorbots",
        "stickup_cams",
        "chimes",
        "intercoms",
    ):
        try:
            values = devices[family]
        except (KeyError, TypeError, AttributeError):
            values = getattr(devices, family, None)
        if values:
            groups[family] = list(values)

    combined = getattr(devices, "devices_combined", None)
    if combined and not groups:
        for device in combined:
            family = str(getattr(device, "family", "unknown") or "unknown")
            groups.setdefault(family, []).append(device)

    return groups


def ring_device_identity(device) -> str:
    value = (
        getattr(device, "device_id", None)
        or getattr(device, "id", None)
        or getattr(device, "account_id", None)
    )
    return str(value or "")


def ring_device_name(device, family: str) -> str:
    return str(getattr(device, "name", None) or f"Ring {family.replace('_', ' ')}")
