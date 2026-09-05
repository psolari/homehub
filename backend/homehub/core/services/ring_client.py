from __future__ import annotations

from collections.abc import Mapping
import time
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

        # HomeHub only needs the authenticated device inventory here. Ring's
        # legacy /clients_api/session endpoint can return 406 even when the
        # OAuth token is valid. python-ring-doorbell normally creates that
        # mobile-app session before updating devices, but device inventory,
        # snapshots and device controls do not require HomeHub to register a
        # separate mobile session. Mark the local Ring object as initialised
        # and fetch devices directly, bypassing /clients_api/session.
        ring.session = {"homehub": True}
        await ring.async_update_devices()
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


async def close_ring_session(ring) -> None:
    auth = getattr(ring, "auth", None)
    closer = getattr(auth, "async_close", None)
    if closer:
        await closer()



async def take_ring_snapshot(
    ring,
    device,
    *,
    max_age: int = 30,
    max_wait: int = 12,
) -> bytes:
    """Fetch a Ring snapshot using Ring's newer server-wait snapshot endpoint.

    python-ring-doorbell 0.9.14's async_get_snapshot() uses the older
    timestamps + image polling flow, which is unreliable for battery cameras.
    The library has an upstream replacement based on app-snaps.ring.com that
    lets Ring wait server-side for a fresh image. HomeHub uses the same API
    contract here while remaining compatible with the released library.
    """
    upstream = getattr(device, "async_take_snapshot", None)
    if upstream:
        data = await upstream(max_age=max_age, max_wait=max_wait)
        if isinstance(data, bytes) and data:
            return data
        raise RingClientError(
            "Ring completed the snapshot request but returned no image data."
        )

    attrs = getattr(device, "_attrs", {}) or {}
    device_id = (
        attrs.get("id")
        or getattr(device, "device_api_id", None)
        or getattr(device, "id", None)
    )
    if device_id is None:
        raise RingClientError(
            "Ring did not expose the camera API ID required for snapshots."
        )

    params = {
        "after-ms": (int(time.time()) - max(0, int(max_age))) * 1000,
        "max-wait-ms": max(1, int(max_wait)) * 1000,
        "extras": "force",
    }

    try:
        response = await ring.async_query(
            f"/snapshots/next/{device_id}",
            extra_params=params,
            base_uri="https://app-snaps.ring.com",
            timeout=max(1, int(max_wait)) + 2,
        )
    except Exception as exc:
        message = exception_message(exc, "Ring snapshot request failed")
        if "404" in message:
            raise RingClientError(
                "Ring did not produce a snapshot before its server-side timeout. "
                "Wait a few seconds and try Refresh camera again."
            ) from exc
        raise RingClientError(message) from exc

    data = getattr(response, "content", None)
    if not isinstance(data, bytes) or not data:
        raise RingClientError(
            "Ring's snapshot service responded but did not return image data."
        )
    return data
