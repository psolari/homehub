import importlib

device_type_map = {
    "lg": "homehub.core.device_modules.tv.lg",
    "samsung": "homehub.core.device_modules.tv.samsung",
}


def get_tv_driver(device_type: str):
    """
    Returns the appropriate TV driver based on the device type.
    """
    if device_type not in device_type_map:
        raise ValueError(f"Unsupported device type: {device_type}")

    module_name = device_type_map[device_type]
    module = importlib.import_module(module_name)
    return getattr(module, "TvDriver")
