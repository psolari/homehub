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
    controls = [Control("play", "Play")]

    async def get_state(self):
        return {"online": True, "status": "on"}

    async def action_play(self):
        ...
```

Do not add vendor conditionals to React. Describe a capability in `controls` and implement it in the backend driver.

## Built-in integrations

| Device | Driver key | Discovery | Primary features |
| --- | --- | --- | --- |
| LG webOS TV | `lg_webos` | TCP probe | pairing, power/WOL, volume, mute, playback buttons, inputs, apps, navigation/channel/remote keys |
| Samsung Tizen TV | `samsung_tizen` | TCP probe | pairing, power/WOL, volume/mute, media, source, apps, navigation/channel/remote keys |
| iRobot Roomba | `irobot_roomba` | TCP probe/manual credentials | clean/pause/resume/stop/dock, battery/mission state, reported pose |
| Sonos | `sonos` | native discovery | playback, volume/mute, input switching, URI playback, Spotify Connect |
| Google Cast/Nest | `google_cast` | mDNS | playback, volume/mute, URL media, Spotify Connect |
| Amazon Alexa/Echo | `alexa_echo` | connected Amazon account | playback, volume, announcements/TTS/custom commands, Spotify Connect |
| Hive Heating | `hive_heating` | connected Hive account | temperature target, mode, boost |
| Ring Camera/Doorbell | `ring_camera` | connected Ring account | state, snapshots, supported light/siren actions |
| Ring Alarm | `ring_alarm_mqtt` | manual/bridge | arm home, arm away, disarm through MQTT bridge |

Every generic HomeHub category also has a status-only `generic` driver so unsupported hardware can still be represented and placed on a floor plan.

## Device pairing secrets

Fields marked `secret` in a driver's configuration schema are removed from the public `Device.config` payload and stored in `encrypted_credentials`. This includes TV pairing tokens and Roomba credentials. Cloud integration accounts use the same encrypted-at-rest approach.

## Spotify

Spotify is an `IntegrationAccount`, not a speaker driver. Speaker drivers reference a Spotify account and optional Spotify Connect target. This keeps music search/playback independent from Sonos, Google and Alexa protocol implementations.

## Roomba floor-plan calibration

Roomba firmware reports coordinates in its own map coordinate system. Configure `map_scale_x`, `map_scale_y`, `map_offset_x` and `map_offset_y` to map those coordinates onto a HomeHub floor plan. The driver reports both transformed and raw coordinates.

## Vendor constraints

- AlexaPy uses Amazon's unofficial web API and can break when Amazon changes private endpoints.
- The Python Ring integration also relies on reverse-engineered cloud endpoints.
- Ring Alarm is separated into an MQTT-bridge driver because general alarm-panel control is not exposed by the Ring Python integration.
- Roomba local support depends on model/firmware support available through `roombapy`.
- Spotify playback control depends on Spotify Connect and account eligibility.

## Testing

Unit/integration tests should mock vendor libraries and validate HomeHub's normalised state/control contract. Hardware end-to-end tests must run on a private network and must never commit credentials, pairing tokens or runtime databases.
