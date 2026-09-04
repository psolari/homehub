from __future__ import annotations

import time
from typing import Any

from django.utils import timezone

from homehub.core.models import IntegrationAccount
from homehub.core.services.accounts import get_credentials, set_credentials
from homehub.core.services.devices import run_async
from homehub.core.services.hive_client import hive_devices, open_hive_session


class IntegrationAccountError(RuntimeError):
    pass


def _require(credentials: dict[str, Any], *names: str) -> None:
    missing = [name for name in names if not credentials.get(name)]
    if missing:
        raise IntegrationAccountError(
            "Missing required credential fields: " + ", ".join(missing)
        )


def _validate_hive(credentials: dict[str, Any]) -> dict[str, Any]:
    _require(credentials, "username", "password")

    async def validate():
        hive = await open_hive_session(credentials)
        devices = hive_devices(hive)
        return {
            "message": "Hive account authenticated successfully.",
            "provider_devices_seen": len(devices),
        }

    return run_async(validate())


def _validate_alexa(credentials: dict[str, Any]) -> dict[str, Any]:
    _require(credentials, "email", "password")

    async def validate():
        from alexapy import AlexaAPI, AlexaLogin

        login = AlexaLogin(
            url=credentials.get("url", "https://alexa.amazon.co.uk"),
            email=credentials["email"],
            password=credentials["password"],
            outputpath=None,
            otp_secret=credentials.get("otp_secret"),
        )
        await login.login(cookies=credentials.get("cookies"))
        devices = await AlexaAPI.get_devices(login)
        return {
            "message": "Amazon Alexa account authenticated successfully.",
            "provider_devices_seen": len(devices or []),
        }

    return run_async(validate())


def _validate_ring(account: IntegrationAccount, credentials: dict[str, Any]) -> dict[str, Any]:
    _require(credentials, "username", "password")
    token_update: dict[str, Any] = {}

    async def validate():
        from ring_doorbell import Auth, Ring
        from ring_doorbell.exceptions import Requires2FAError

        def token_updated(token):
            token_update["token"] = token

        auth = Auth("HomeHub/1.0", credentials.get("token"), token_updated)
        try:
            if not credentials.get("token"):
                await auth.async_fetch_token(
                    credentials["username"],
                    credentials["password"],
                    credentials.get("otp"),
                )
        except Requires2FAError as exc:
            raise IntegrationAccountError(
                "Ring requires a fresh two-factor authentication code. Enter it and try again."
            ) from exc

        ring = Ring(auth)
        if hasattr(ring, "async_create_session"):
            await ring.async_create_session()
        if hasattr(ring, "async_update_data"):
            await ring.async_update_data()
        devices = ring.devices()
        if hasattr(devices, "__await__"):
            devices = await devices

        count = 0
        if isinstance(devices, dict):
            count = sum(len(values or []) for values in devices.values())
        return {
            "message": "Ring account authenticated successfully.",
            "provider_devices_seen": count,
        }

    result = run_async(validate())
    if token_update.get("token"):
        set_credentials(account, {"token": token_update["token"]})
    return result


def _validate_ring_alarm_mqtt(credentials: dict[str, Any]) -> dict[str, Any]:
    _require(credentials, "broker")

    def validate():
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if credentials.get("username"):
            client.username_pw_set(
                credentials.get("username"),
                credentials.get("password"),
            )
        host = str(credentials["broker"])
        port = int(credentials.get("port", 1883))
        try:
            result = client.connect(host, port, keepalive=5)
            if result != mqtt.MQTT_ERR_SUCCESS:
                raise IntegrationAccountError(
                    f"MQTT broker connection failed with code {result}."
                )
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not client.is_connected():
                loop_result = client.loop(timeout=0.2)
                if loop_result not in {
                    mqtt.MQTT_ERR_SUCCESS,
                    mqtt.MQTT_ERR_AGAIN,
                }:
                    raise IntegrationAccountError(
                        f"MQTT broker authentication failed with code {loop_result}."
                    )
            if not client.is_connected():
                raise IntegrationAccountError(
                    "The MQTT broker did not accept the HomeHub connection."
                )
            return {
                "message": "Ring Alarm MQTT broker connection verified.",
                "provider_devices_seen": 0,
            }
        finally:
            try:
                client.disconnect()
            except Exception:
                pass

    return validate()


def validate_integration_account(account: IntegrationAccount) -> dict[str, Any]:
    credentials = get_credentials(account)
    validators = {
        "hive": lambda: _validate_hive(credentials),
        "alexa": lambda: _validate_alexa(credentials),
        "ring": lambda: _validate_ring(account, credentials),
        "ring_alarm_mqtt": lambda: _validate_ring_alarm_mqtt(credentials),
    }
    validator = validators.get(account.provider)
    if validator is None:
        raise IntegrationAccountError(
            f"{account.get_provider_display()} does not use direct credential validation."
        )
    result = validator()
    return {
        **result,
        "verified_at": timezone.now().isoformat(),
    }
