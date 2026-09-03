from homehub.core.integrations.base import BaseDriver
from homehub.core.integrations.registry import register_driver


def _register_generic(device_type: str, label: str):
    async def get_state(self):
        state = dict(self.device.state or {})
        state.setdefault("online", bool(self.device.is_online))
        state.setdefault("status", self.device.status or "unknown")
        return state
    register_driver(type(f"Generic{device_type.title()}Driver", (BaseDriver,), {"driver_key":"generic","device_type":device_type,"display_name":f"Generic {label}","manufacturer":"Generic","controls":[],"get_state":get_state}))

for _type, _label in [("light","Light"),("switch","Switch"),("sensor","Sensor"),("thermostat","Thermostat"),("camera","Camera"),("tv","TV"),("speaker","Speaker"),("vacuum","Vacuum"),("security","Security System"),("appliance","Appliance")]:
    _register_generic(_type, _label)
