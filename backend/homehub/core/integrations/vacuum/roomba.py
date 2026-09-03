import time

from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver


@register_driver
class RoombaDriver(BaseDriver):
    driver_key = "irobot_roomba"
    device_type = "vacuum"
    display_name = "iRobot Roomba"
    manufacturer = "iRobot"
    config_schema = [
        {
            "name": "blid",
            "label": "Robot BLID",
            "type": "string",
            "required": True,
            "secret": True,
            "description": "The robot username/BLID. HomeHub needs this for the local MQTT connection.",
        },
        {
            "name": "password",
            "label": "Robot password",
            "type": "password",
            "required": True,
            "secret": True,
            "description": "The robot-local password. HomeHub can try to retrieve this during setup.",
        },
        {"name": "map_scale_x", "label": "Floor-plan X scale", "type": "number", "default": 1},
        {"name": "map_scale_y", "label": "Floor-plan Y scale", "type": "number", "default": 1},
        {"name": "map_offset_x", "label": "Floor-plan X offset", "type": "number", "default": 0},
        {"name": "map_offset_y", "label": "Floor-plan Y offset", "type": "number", "default": 0},
    ]
    setup_schema = {
        "description": "Connect directly to the Roomba on your home network and verify its local credentials before adding it.",
        "requires_ip": True,
        "instructions": [
            "Make sure the Roomba is powered on, on its dock, and connected to the same network as HomeHub.",
            "Enter the robot BLID. If you already know the local robot password, enter it too.",
            "To retrieve the password automatically, hold the robot's HOME/CLEAN pairing button until it chimes and the Wi-Fi indicator flashes, then immediately click Retrieve password.",
            "Some newer iRobot firmware does not expose the password locally. In that case, enter credentials obtained from a compatible iRobot credential tool instead.",
        ],
        "actions": [
            {
                "key": "retrieve_password",
                "label": "Retrieve password from Roomba",
                "description": "Put the robot into local pairing mode first. HomeHub will connect to port 8883 and request its local password.",
                "requires": ["ip_address"],
                "result_fields": ["password"],
            }
        ],
        "test_connection": True,
        "advanced_fields": ["map_scale_x", "map_scale_y", "map_offset_x", "map_offset_y"],
    }
    controls = [
        Control("start", "Start", group="cleaning"),
        Control("pause", "Pause", group="cleaning"),
        Control("resume", "Resume", group="cleaning"),
        Control("stop", "Stop", group="cleaning"),
        Control("dock", "Dock", group="cleaning"),
    ]

    @classmethod
    async def run_setup_action(cls, action, *, device_data, config, parameters=None):
        if action != "retrieve_password":
            return await super().run_setup_action(
                action,
                device_data=device_data,
                config=config,
                parameters=parameters,
            )
        host = str(device_data.get("ip_address") or "").strip()
        if not host:
            raise IntegrationError("Enter the Roomba IP address before retrieving its password.")

        def retrieve():
            try:
                from roombapy.getpassword import RoombaPassword
            except ImportError as exc:
                raise IntegrationError("roombapy is not installed") from exc
            password = RoombaPassword(host).get_password()
            if not password:
                raise IntegrationError(
                    "The Roomba did not return a password. Confirm it is on the dock and in pairing mode, then try again."
                )
            return str(password)

        password = await cls.to_thread(retrieve)
        return {
            "message": "Roomba password retrieved. Continue to connection test.",
            "config": {"password": password},
        }

    def _client(self):
        host = str(self.device.ip_address or "").strip()
        blid = str(self.config.get("blid") or "").strip()
        password = str(self.config.get("password") or "")
        if not host:
            raise IntegrationError("Roomba requires an IP address.")
        if not blid or not password:
            raise IntegrationError("Roomba requires both a BLID and local robot password.")
        try:
            from roombapy.roomba_factory import RoombaFactory
        except ImportError as exc:
            raise IntegrationError("roombapy is not installed") from exc
        return RoombaFactory.create_roomba(
            address=host,
            blid=blid,
            password=password,
            continuous=True,
        )

    def _with(self, callback):
        client = self._client()
        try:
            client.connect()
            time.sleep(0.8)
            return callback(client)
        finally:
            try:
                client.disconnect()
            except Exception:
                pass

    def _read(self, client):
        master = client.master_state or {}
        state = master.get("state", master)
        reported = state.get("reported", state) if isinstance(state, dict) else {}
        mission = reported.get("cleanMissionStatus") or {}
        phase = mission.get("phase") or "unknown"
        pose = reported.get("pose") or reported.get("pose2") or {}
        point = pose.get("point", pose) if isinstance(pose, dict) else {}
        location = None
        try:
            raw_x, raw_y = float(point.get("x")), float(point.get("y"))
            location = {
                "x": raw_x * float(self.config.get("map_scale_x", 1) or 1)
                + float(self.config.get("map_offset_x", 0) or 0),
                "y": raw_y * float(self.config.get("map_scale_y", 1) or 1)
                + float(self.config.get("map_offset_y", 0) or 0),
                "heading": float(pose.get("theta", 0) or 0),
                "raw_x": raw_x,
                "raw_y": raw_y,
            }
        except (TypeError, ValueError):
            pass
        return {
            "online": True,
            "status": "running" if phase in {"run", "hmUsrDock", "hmMidMsn", "charge"} else "idle",
            "power": "on",
            "battery": reported.get("batPct"),
            "phase": phase,
            "mission": mission,
            "location": location,
            "bin_full": bool((reported.get("bin") or {}).get("full"))
            if isinstance(reported.get("bin"), dict)
            else None,
        }

    async def get_state(self):
        return await self.to_thread(self._with, self._read)

    async def _command(self, command):
        def send(client):
            client.send_command(command)
            time.sleep(0.25)
            return {"ok": True, "command": command}

        return await self.to_thread(self._with, send)

    async def action_start(self):
        return await self._command("start")

    async def action_pause(self):
        return await self._command("pause")

    async def action_resume(self):
        return await self._command("resume")

    async def action_stop(self):
        return await self._command("stop")

    async def action_dock(self):
        return await self._command("dock")
