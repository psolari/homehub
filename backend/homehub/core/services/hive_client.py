from __future__ import annotations

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
        tokens = await auth.login()
    except Exception as exc:
        if exc.__class__.__name__ == "HiveSmsRequired":
            raise HiveClientError(
                "Hive accepted the account details but requires SMS two-factor authentication. "
                "HomeHub needs a Hive 2FA step before this account can be connected."
            ) from exc
        raise HiveClientError(
            exception_message(exc, "Hive authentication failed")
        ) from exc

    if not tokens:
        raise HiveClientError("Hive login completed but did not return authentication tokens.")

    try:
        hive = Hive(username=username, password=password)
        await hive.startSession({"tokens": tokens})
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
