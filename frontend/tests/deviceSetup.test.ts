import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSetupPayload,
  missingSetupRequirements,
  setupValuesFrom,
} from "../src/features/devices/deviceSetup.ts";
import type { Device, DriverDefinition } from "../src/shared/types.ts";

const roomba: DriverDefinition = {
  key: "irobot_roomba",
  device_type: "vacuum",
  display_name: "iRobot Roomba",
  manufacturer: "iRobot",
  controls: [],
  fields: [
    { name: "blid", label: "Robot BLID", type: "string", required: true, secret: true },
    { name: "password", label: "Robot password", type: "password", required: true, secret: true },
    { name: "map_scale_x", label: "X scale", type: "number", default: 1 },
  ],
  setup: { requires_ip: true, test_connection: true, advanced_fields: ["map_scale_x"] },
};

const samsung: DriverDefinition = {
  key: "samsung_tizen",
  device_type: "tv",
  display_name: "Samsung Tizen TV",
  manufacturer: "Samsung",
  controls: [],
  fields: [
    { name: "token", label: "Pairing token", type: "password", secret: true, required: false },
    { name: "port", label: "Port", type: "number", default: 8002 },
  ],
  setup: { requires_ip: true, test_connection: true, advanced_fields: ["token", "port"] },
};

test("Roomba setup requires IP, BLID and robot password", () => {
  const values = setupValuesFrom(roomba);
  values.name = "Downstairs Roomba";
  assert.deepEqual(
    missingSetupRequirements(roomba, values),
    ["IP address", "Robot BLID", "Robot password"],
  );
});

test("an existing encrypted Roomba password counts as configured", () => {
  const existing = {
    id: 3,
    name: "Roomba",
    device_type: "vacuum",
    model: "irobot_roomba",
    status: "error",
    ip_address: "192.168.1.40",
    config: {},
    configured_credentials: ["blid", "password"],
  } as Device;
  const values = setupValuesFrom(roomba, null, existing);
  assert.deepEqual(missingSetupRequirements(roomba, values, existing), []);
});

test("Samsung token is optional because first connection performs pairing", () => {
  const values = setupValuesFrom(samsung);
  values.name = "Living Room TV";
  values.ip_address = "192.168.1.50";
  assert.deepEqual(missingSetupRequirements(samsung, values), []);
  const payload = buildSetupPayload(values, samsung);
  assert.equal(payload.validate_connection, true);
  assert.equal(payload.config.port, 8002);
  assert.equal("token" in payload.config, false);
});

test("setup payload does not blank an existing secret", () => {
  const existing = {
    id: 4,
    name: "Roomba",
    device_type: "vacuum",
    model: "irobot_roomba",
    status: "error",
    ip_address: "192.168.1.40",
    config: { map_scale_x: 1 },
    configured_credentials: ["blid", "password"],
  } as Device;
  const values = setupValuesFrom(roomba, null, existing);
  const payload = buildSetupPayload(values, roomba, existing);
  assert.equal("blid" in payload.config, false);
  assert.equal("password" in payload.config, false);
  assert.equal(payload.config.map_scale_x, 1);
});
