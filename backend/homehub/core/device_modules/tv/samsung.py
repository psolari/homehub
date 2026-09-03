import os
from samsungtvws import SamsungTVWS

from homehub.core.device_modules.tv.default import TvDriver
from homehub.core.models import Device


TOKEN_DIR = os.path.join(os.path.dirname(__file__), "tokens")
os.makedirs(TOKEN_DIR, exist_ok=True)


class TvDriver(TvDriver):

    def __init__(self, tv: Device):
        self.token_file = os.path.join(TOKEN_DIR, f"{tv.ip_address}.txt")
        self.tv = SamsungTVWS(host=tv.ip_address, port=8002, token_file=self.token_file)

    def toggle_power(self):
        """
        Toggle power on/off for the Samsung TV.
        Requires the TV to have been paired before (token file exists),
        otherwise the TV will show an approval popup the first time.
        """
        try:
            self.tv.shortcuts().power()
            return {"status": "success", "ip": self.ip}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def power_on(self):
        """
        Power on the Samsung TV.
        """
        self.toggle_power()

    def power_off(self):
        """
        Power off the Samsung TV.
        """
        self.toggle_power()

    def mute(self):
        """
        Mute the Samsung TV.
        """
        try:
            self.tv.shortcuts().mute()
            return {"status": "success"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def volume_up(self):
        """
        Increase the volume of the Samsung TV.
        """
        try:
            self.tv.shortcuts().volume_up()
            return {"status": "success"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def volume_down(self):
        """
        Decrease the volume of the Samsung TV.
        """
        try:
            self.tv.shortcuts().volume_down()
            return {"status": "success"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
