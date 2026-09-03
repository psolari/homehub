from homehub.core.integrations.base import BaseDriver
from homehub.core.integrations.registry import register_driver


def _register_generic(device_type: str, label: str):
    async def get_state(self):
        state = dict(self.device.state or {})
        state.setdefault("online", bool(self.device.is_online))
        state.setdefault("status", self.device.status or "unknown")
        return state

    register_driver(
        type(
            f"Generic{device_type.title()}Driver",
            (BaseDriver,),
            {
                "driver_key": "generic",
                "device_type": device_type,
                "display_name": f"Generic {label}",
                "manufacturer": "Generic",
                "controls": [],
                "get_state": get_state,
                "setup_schema": {
                    "description": f"Store a {label.lower()} in HomeHub without a vendor-specific control driver.",
                    "requires_ip": False,
                    "instructions": [
                        "Use Generic when HomeHub does not yet have a dedicated integration for this device.",
                        "You can record its name, manufacturer, model, IP and MAC address, but HomeHub will not actively control it until a compatible driver is added.",
                    ],
                    "test_connection": False,
                    "advanced_fields": [],
                },
            },
        )
    )


for _type, _label in [
    ("light", "Light"),
    ("switch", "Switch"),
    ("sensor", "Sensor"),
    ("thermostat", "Thermostat"),
    ("camera", "Camera"),
    ("tv", "TV"),
    ("speaker", "Speaker"),
    ("vacuum", "Vacuum"),
    ("security", "Security System"),
    ("appliance", "Appliance"),
]:
    _register_generic(_type, _label)
