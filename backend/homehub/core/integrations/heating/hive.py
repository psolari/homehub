from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver
from homehub.core.services.accounts import get_active_account, get_account_credentials
from homehub.core.services.hive_client import hive_devices, open_hive_session


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
        account = await self.to_thread(
            get_active_account,
            "hive",
            self.config.get("account_id"),
        )
        credentials = await self.to_thread(get_account_credentials, account)
        return await open_hive_session(credentials)

    async def _device(self):
        hive = await self._session()
        wanted = str(self.config.get("hive_device_id"))
        device = next(
            (
                item
                for item in hive_devices(hive)
                if str(
                    self._value(
                        item,
                        "id",
                        "device_id",
                        "deviceId",
                        default="",
                    )
                )
                == wanted
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

    async def action_target_temperature(self, value):
        hive, device = await self._device()
        return await hive.heating.set_target_temperature(device, float(value))

    async def action_mode(self, value):
        hive, device = await self._device()
        return await hive.heating.set_mode(device, str(value).upper())

    async def action_boost(self, minutes=30, temperature=22):
        hive, device = await self._device()
        return await hive.heating.set_boost_on(
            device,
            mins=int(minutes),
            temp=float(temperature),
        )

    async def action_boost_off(self):
        hive, device = await self._device()
        return await hive.heating.set_boost_off(device)
