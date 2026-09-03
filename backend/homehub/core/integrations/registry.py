from __future__ import annotations
from collections import defaultdict
from typing import TypeVar
from homehub.core.integrations.base import BaseDriver, IntegrationError

DriverT = TypeVar("DriverT", bound=type[BaseDriver])
_REGISTRY: dict[tuple[str,str], type[BaseDriver]] = {}


def register_driver(cls: DriverT) -> DriverT:
    key = (cls.device_type, cls.driver_key)
    if key in _REGISTRY:
        raise RuntimeError(f"Duplicate device driver registration: {key}")
    _REGISTRY[key] = cls
    return cls


def get_driver(device_type: str, driver_key: str | None) -> type[BaseDriver]:
    driver = _REGISTRY.get((device_type, driver_key or "generic"))
    if driver is None:
        raise IntegrationError(f"No HomeHub driver is registered for {device_type}/{driver_key}.")
    return driver


def iter_drivers():
    return list(_REGISTRY.values())


def get_driver_catalog():
    result = defaultdict(dict)
    for driver in _REGISTRY.values():
        result[driver.device_type][driver.driver_key] = driver.catalog_entry()
    return dict(result)
