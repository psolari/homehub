import time

from homehub.core.integrations.base import BaseDriver, Control, IntegrationError
from homehub.core.integrations.registry import register_driver
from homehub.core.services.roomba_cloud_tracking import roomba_cloud_tracking_manager
from homehub.core.services.roomba_tracking import (
    build_roomba_state,
    roomba_tracking_manager,
)


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
        {
            "name": "irobot_account_id",
            "label": "iRobot cloud account",
            "type": "number",
            "required": False,
            "description": "Optional. Used for live-map position tracking when newer firmware no longer publishes local pose data.",
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
        "optional_accounts": [
            {
                "provider": "irobot",
                "field": "irobot_account_id",
                "label": "iRobot cloud account",
                "description": "Recommended for newer SMART-tier Roombas. Local controls remain local; the cloud account supplies live floor-plan position when the firmware omits local pose data.",
            }
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
        "advanced_fields": ["irobot_account_id", "map_scale_x", "map_scale_y", "map_offset_x", "map_offset_y"],
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

    def _tracked_client(self):
        return roomba_tracking_manager.ensure(self.device, self.config)

    def _read_tracked(self):
        client = self._tracked_client()
        roomba_tracking_manager.wait_until_ready(self.device.id, timeout=2.5)
        state = build_roomba_state(client, self.config)

        # Newer SMART-tier firmware (notably cap.pose=2 i7-family robots)
        # can keep local MQTT state/control working while omitting the old
        # pose field entirely. In that case iRobot's cloud live-map stream is
        # the authoritative source for the moving position.
        try:
            pose_capability = int(state.get("pose_capability") or 0)
        except (TypeError, ValueError):
            pose_capability = 0

        if not state.get("location") and pose_capability >= 2:
            roomba_cloud_tracking_manager.ensure(self.device, self.config)
            cloud_location = roomba_cloud_tracking_manager.location(self.device.id)
            cloud = roomba_cloud_tracking_manager.diagnostics(
                self.device.id,
                config=self.config,
            )
            if cloud_location:
                state["location"] = cloud_location
                state["tracking_status"] = "live_cloud"
            elif cloud.get("configured"):
                state["tracking_status"] = "waiting_for_cloud_position"
            else:
                state["tracking_status"] = "cloud_account_required"
            state["cloud_tracking_status"] = cloud.get("status")

        return state

    async def get_state(self):
        return await self.to_thread(self._read_tracked)

    async def _command(self, command):
        def send():
            client = self._tracked_client()
            client.send_command(command)
            time.sleep(0.25)
            return {"ok": True, "command": command}

        return await self.to_thread(send)

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
