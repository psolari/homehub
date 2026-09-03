from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account, get_account_credentials


@register_driver
class HiveHeatingDriver(BaseDriver):
    driver_key = "hive_heating"
    device_type = "thermostat"
    display_name = "Hive Heating"
    manufacturer = "Hive"
    config_schema = [
        {
            "name": "account_id",
            "label": "Hive account",
            "type": "number",
            "required": True,
            "description": "The configured HomeHub Hive account that owns this heating zone/device.",
        },
        {
            "name": "hive_device_id",
            "label": "Hive heating device ID",
            "type": "string",
            "required": True,
            "description": "Usually filled automatically when HomeHub discovers heating devices from the Hive account.",
        },
    ]
    setup_schema = {
        "description": "Link this thermostat/heating zone to a Hive cloud account and verify that HomeHub can read it.",
        "requires_ip": False,
        "instructions": [
            "Hive heating is controlled through your Hive account rather than a local device IP address.",
            "Choose an existing Hive integration account or configure one inside the wizard.",
            "HomeHub normally discovers each heating zone after the Hive account is connected, so the Hive device ID should already be filled for discovered devices.",
        ],
        "account_provider": "hive",
        "account_field": "account_id",
        "test_connection": True,
        "advanced_fields": [],
    }
    controls = [
        Control("target_temperature", "Target temperature", type="range", group="heating", parameter="value", minimum=5, maximum=32, step=0.5),
        Control(
            "mode",
            "Mode",
            type="select",
            group="heating",
            parameter="value",
            options=[
                {"value": "SCHEDULE", "label": "Schedule"},
                {"value": "MANUAL", "label": "Manual"},
                {"value": "OFF", "label": "Off"},
            ],
        ),
        Control("boost", "Boost", type="number_pair", group="heating"),
        Control("boost_off", "Stop boost", group="heating"),
    ]

    async def _session(self):
        from apyhiveapi import Auth, Hive

        credentials = get_account_credentials(
            get_active_account("hive", account_id=self.config.get("account_id"))
        )
        auth = Auth(credentials.get("username", ""), credentials.get("password", ""))
        tokens = await auth.login()
        hive = Hive(tokens)
        await hive.startSession(tokens)
        return hive

    async def _device(self):
        hive = await self._session()
        wanted = str(self.config.get("hive_device_id"))
        data = getattr(getattr(hive, "session", None), "data", None)
        devices = getattr(data, "devices", data)
        if isinstance(devices, dict):
            device = devices.get(wanted) or next(
                (value for key, value in devices.items() if str(key) == wanted), None
            )
        else:
            device = next(
                (
                    item
                    for item in (devices or [])
                    if str(getattr(item, "id", getattr(item, "device_id", ""))) == wanted
                ),
                None,
            )
        if device is None:
            raise IntegrationError("Hive heating device was not found")
        return hive, device

    @staticmethod
    def _value(obj, *names, default=None):
        for name in names:
            if isinstance(obj, dict) and name in obj:
                return obj[name]
            if hasattr(obj, name):
                return getattr(obj, name)
        return default

    async def get_state(self):
        _, device = await self._device()
        return {
            "online": True,
            "status": "on",
            "power": "on",
            "temperature": self._value(device, "current_temperature", "temperature", "currentTemperature"),
            "target_temperature": self._value(device, "target_temperature", "target", "targetTemperature"),
            "mode": self._value(device, "mode", "heating_mode", default="unknown"),
            "boost": self._value(device, "boost", "boost_status"),
        }

    async def _invoke(self, names, *args):
        hive, device = await self._device()
        for holder in (device, getattr(hive, "heating", None), hive):
            if holder:
                for name in names:
                    function = getattr(holder, name, None)
                    if function:
                        result = function(*args)
                        return await result if hasattr(result, "__await__") else result
        raise IntegrationError(f"Hive operation is unavailable: {names[0]}")

    async def action_target_temperature(self, value):
        return await self._invoke(("set_target_temperature", "setTargetTemperature"), float(value))

    async def action_mode(self, value):
        return await self._invoke(("set_mode", "setMode"), str(value).upper())

    async def action_boost(self, minutes=30, temperature=22):
        return await self._invoke(
            ("boost", "set_boost", "setBoost"), int(minutes), float(temperature)
        )

    async def action_boost_off(self):
        return await self._invoke(("boost_off", "cancel_boost", "cancelBoost"))
