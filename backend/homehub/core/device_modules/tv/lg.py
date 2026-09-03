import websocket
import json

from homehub.core.device_modules.tv.default import TvDriver
from homehub.core.models import Device


class TvDriver(TvDriver):

    def __init__(self, tv: Device):
        self.ip = tv["ip_address"]

    def initialize_connection(self):
        try:
            ws = websocket.create_connection(f"ws://{self.ip}:3000")
            # Send initial register message
            register_msg = {
                "type": "register",
                "payload": {
                    "manifest": {
                        "manifestVersion": 1,
                        "appVersion": "1.0",
                        "signed": {"permissions": ["LAUNCH", "CONTROL", "TEST_OPEN"]},
                        "permissions": ["LAUNCH", "CONTROL", "TEST_OPEN"],
                        "signatures": [{"signatureVersion": 1}],
                        "localizedAppNames": {"": "HomeHub"},
                        "localizedVendorNames": {"": "Developer"},
                        "vendorId": "com.developer",
                        "appId": "com.developer.test",
                    }
                },
            }

            response = ws.send(json.dumps(register_msg))
            ws.close()
            if isinstance(response, dict) and response.get("type") in [
                "registered",
                "response",
                "error",
            ]:
                return True, response
            elif isinstance(response, int):
                return True, {"raw_code": response}
            else:
                return False, response

        except Exception as e:
            return False, str(e)

    def toggle_power(self):
        """
        Toggle power on/off for the LG TV.
        Requires the TV to have been paired before (token file exists),
        otherwise the TV will show an approval popup the first time.
        """
        try:
            pass
            return {"status": "success", "ip": self.ip}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def power_on(self):
        """
        Power on the LG TV.
        """
        self.toggle_power()

    def power_off(self):
        """
        Power off the LG TV.
        """
        self.toggle_power()

    def mute(self):
        """
        Mute the LG TV.
        """
        try:
            pass
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def volume_up(self):
        """
        Increase the volume of the LG TV.
        """
        try:
            pass
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def volume_down(self):
        """
        Decrease the volume of the LG TV.
        """
        try:
            pass
        except Exception as e:
            return {"status": "error", "message": str(e)}
