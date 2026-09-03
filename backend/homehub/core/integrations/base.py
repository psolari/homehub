from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from homehub.core.models import Device


class IntegrationError(RuntimeError):
    pass


class IntegrationUnavailable(IntegrationError):
    pass


class TwoFactorRequired(IntegrationError):
    pass


@dataclass(frozen=True)
class Control:
    action: str
    label: str
    type: str = "button"
    group: str = "main"
    icon: str | None = None
    parameter: str | None = None
    minimum: float | None = None
    maximum: float | None = None
    step: float | None = None
    options: list[dict[str, Any]] = field(default_factory=list)
    options_from_state: str | None = None
    placeholder: str | None = None

    def as_dict(self) -> dict[str, Any]:
        data = {
            "action": self.action,
            "label": self.label,
            "type": self.type,
            "group": self.group,
        }
        for key, value in {
            "icon": self.icon,
            "parameter": self.parameter,
            "min": self.minimum,
            "max": self.maximum,
            "step": self.step,
            "options": self.options or None,
            "options_from_state": self.options_from_state,
            "placeholder": self.placeholder,
        }.items():
            if value is not None:
                data[key] = value
        return data


class BaseDriver:
    driver_key = "generic"
    device_type = "appliance"
    display_name = "Generic Device"
    manufacturer = ""
    config_schema: list[dict[str, Any]] = []
    controls: list[Control] = []

    # Setup metadata is intentionally data-driven so the React onboarding flow
    # can remain vendor-neutral. Drivers only describe what they need.
    setup_schema: dict[str, Any] = {
        "description": "Add the device to HomeHub.",
        "requires_ip": False,
        "requires_mac": False,
        "instructions": [],
        "account_provider": None,
        "account_field": None,
        "optional_accounts": [],
        "actions": [],
        "test_connection": False,
        "advanced_fields": [],
    }

    def __init__(self, device: Device):
        self.device = device
        self.config = dict(device.config or {})
        if device.encrypted_credentials:
            from homehub.core.services.device_config import get_device_credentials

            self.config.update(get_device_credentials(device))

    @classmethod
    def catalog_entry(cls) -> dict[str, Any]:
        setup = dict(BaseDriver.setup_schema)
        setup.update(cls.setup_schema or {})
        return {
            "key": cls.driver_key,
            "device_type": cls.device_type,
            "display_name": cls.display_name,
            "manufacturer": cls.manufacturer,
            "fields": cls.config_schema,
            "controls": [control.as_dict() for control in cls.controls],
            "setup": setup,
        }

    @classmethod
    async def discover_account(cls, account) -> list[dict[str, Any]]:
        return []

    @classmethod
    async def run_setup_action(
        cls,
        action: str,
        *,
        device_data: dict[str, Any],
        config: dict[str, Any],
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise IntegrationError(f"{cls.display_name} does not support setup action '{action}'.")

    def capabilities(self) -> dict[str, Any]:
        return {
            "driver": self.driver_key,
            "device_type": self.device_type,
            "controls": [control.as_dict() for control in self.controls],
        }

    async def initialize(self) -> dict[str, Any]:
        return await self.get_state()

    async def get_state(self) -> dict[str, Any]:
        return {"online": False, "status": "unknown"}

    async def execute(self, action: str, parameters: dict[str, Any] | None = None) -> Any:
        method = getattr(self, f"action_{action}", None)
        if method is None or action.startswith("_"):
            raise IntegrationError(f"{self.display_name} does not support action '{action}'.")
        result = method(**(parameters or {}))
        return await result if asyncio.iscoroutine(result) else result

    async def camera_frame(self) -> tuple[bytes, str] | None:
        return None

    @staticmethod
    async def to_thread(func, *args, **kwargs):
        return await asyncio.to_thread(func, *args, **kwargs)
