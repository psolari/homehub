# Device integration guide

## Integration contract

Drivers live under `backend/homehub/core/integrations/`, subclass `BaseDriver` and register with `@register_driver`.

```python
@register_driver
class ExampleDriver(BaseDriver):
    driver_key = "example"
    device_type = "speaker"
    display_name = "Example Speaker"
    manufacturer = "Example"
    config_schema = []
    setup_schema = {
        "description": "Connect an Example speaker.",
        "requires_ip": True,
        "instructions": ["Keep the speaker on the same network as HomeHub."],
        "test_connection": True,
    }
    controls = [Control("play", "Play")]

    async def get_state(self):
        return {"online": True, "status": "on"}

    async def action_play(self):
        ...
```

Do not add vendor conditionals to React. Describe capabilities in `controls`, onboarding in `setup_schema`, configuration in `config_schema`, and implement vendor behaviour in the backend driver.

## Setup wizard contract

Every HomeHub driver publishes enough metadata for the generic React setup wizard. The wizard is used for discovered devices, manual additions and reconfiguring an existing device.

`config_schema` describes the actual device configuration fields. Fields marked `secret` are encrypted by the backend and are never returned to the browser after setup. `setup_schema` describes how those fields should be collected and verified:

- `requires_ip` / `requires_mac` make network identity mandatory for drivers that need it.
- `instructions` gives the user integration-specific pairing steps.
- `account_provider` and `account_field` link cloud-controlled devices to a HomeHub integration account.
- `optional_accounts` adds optional services such as Spotify without coupling the speaker driver to account setup UI.
- `advanced_fields` keeps uncommon protocol details out of the normal path while still making them configurable.
- `actions` exposes safe pre-creation helpers such as Roomba password retrieval.
- `test_connection` controls whether HomeHub must successfully pair/authenticate/read state before setup can finish.

New device setup uses `/api/v1/devices/complete-setup/`. For integrations requiring a connection test, creation is transactional: a failed pairing/login test returns the actual error to the wizard and does not leave a broken new Device row behind. Existing devices can be repaired through `/api/v1/devices/{id}/setup/`; the UI exposes this as **Finish setup** for devices already in an error state.

## Built-in integrations

| Device | Driver key | Discovery | Setup requirements | Primary features |
| --- | --- | --- | --- | --- |
| LG webOS TV | `lg_webos` | TCP probe | IP; approve first-time TV pairing; MAC recommended for wake | pairing, power/WOL, volume, mute, playback buttons, inputs, apps, navigation/channel/remote keys |
| Samsung Tizen TV | `samsung_tizen` | TCP probe | IP; approve HomeHub on TV; token saved automatically; MAC recommended for wake | pairing, power/WOL, volume/mute, media, source, apps, navigation/channel/remote keys |
| iRobot Roomba | `irobot_roomba` | TCP probe/manual credentials | IP, BLID and local robot password; wizard can request the local password while robot is in pairing mode | clean/pause/resume/stop/dock, battery/mission state, reported pose |
| Sonos | `sonos` | native discovery | local IP; optional Spotify account | playback, volume/mute, input switching, URI playback, Spotify Connect |
| Google Cast/Nest | `google_cast` | mDNS | local Cast target; optional Spotify account | playback, volume/mute, URL media, Spotify Connect |
| Amazon Alexa/Echo | `alexa_echo` | connected Amazon account | Alexa account plus discovered device serial; optional Spotify account | playback, volume, announcements/TTS/custom commands, Spotify Connect |
| Hive Heating | `hive_heating` | connected Hive account | Hive account plus discovered heating-zone/device ID | temperature target, mode, boost |
| Ring Camera/Doorbell | `ring_camera` | connected Ring account | Ring account plus discovered device ID; 2FA may be requested | state, snapshots, supported light/siren actions |
| Ring Alarm | `ring_alarm_mqtt` | manual/bridge | MQTT bridge account and alarm topic; broker authentication is tested without sending an alarm command | arm home, arm away, disarm through MQTT bridge |

Every generic HomeHub category also has a status-only `generic` driver. Its wizard stores identity/network metadata without pretending an unsupported device has a working control integration.

## Device pairing secrets

Fields marked `secret` in a driver's configuration schema are removed from the public `Device.config` payload and stored in `encrypted_credentials`. This includes TV pairing tokens and Roomba credentials. Cloud integration accounts use the same encrypted-at-rest approach.

For reconfiguration, the API returns only `configured_credentials`, which is a list of secret field names already present. The wizard can therefore show “already configured” without revealing the value and can leave a secret blank to preserve it.

## Spotify

Spotify is an `IntegrationAccount`, not a speaker driver. Speaker drivers reference a Spotify account and optional Spotify Connect target. This keeps music search/playback independent from Sonos, Google and Alexa protocol implementations. The device setup wizard can create/select that account inline when a speaker advertises Spotify as an optional account dependency.

## Roomba setup and floor-plan calibration

Roomba local control requires an IP address, BLID and robot-local password. The setup wizard explains the local pairing process and can call the `retrieve_password` setup action after the robot has been placed on its dock and put into pairing mode. Firmware/model support for local credential retrieval varies, so the wizard also accepts manually obtained credentials.

Roomba firmware reports coordinates in its own map coordinate system. Configure `map_scale_x`, `map_scale_y`, `map_offset_x` and `map_offset_y` in advanced setup to map those coordinates onto a HomeHub floor plan. The driver reports both transformed and raw coordinates.

## Vendor constraints

- AlexaPy uses Amazon's unofficial web API and can break when Amazon changes private endpoints.
- The Python Ring integration also relies on reverse-engineered cloud endpoints.
- Ring Alarm is separated into an MQTT-bridge driver because general alarm-panel control is not exposed by the Ring Python integration.
- Roomba local support depends on model/firmware support available through `roombapy`.
- Spotify playback control depends on Spotify Connect and account eligibility.

## Testing

Unit/integration tests should mock vendor libraries and validate HomeHub's normalised state/control/setup contract. Hardware end-to-end tests must run on a private network and must never commit credentials, pairing tokens or runtime databases.
