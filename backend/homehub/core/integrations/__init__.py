from homehub.core.integrations.registry import get_driver, get_driver_catalog, iter_drivers
from homehub.core.integrations import generic as _generic  # noqa: F401
from homehub.core.integrations.heating import hive as _hive  # noqa: F401
from homehub.core.integrations.security import ring as _ring  # noqa: F401
from homehub.core.integrations.security import ring_alarm as _ring_alarm  # noqa: F401
from homehub.core.integrations.speaker import alexa as _alexa  # noqa: F401
from homehub.core.integrations.speaker import google_cast as _google_cast  # noqa: F401
from homehub.core.integrations.speaker import sonos as _sonos  # noqa: F401
from homehub.core.integrations.tv import lg as _lg  # noqa: F401
from homehub.core.integrations.tv import samsung as _samsung  # noqa: F401
from homehub.core.integrations.vacuum import roomba as _roomba  # noqa: F401

__all__ = ["get_driver", "get_driver_catalog", "iter_drivers"]
