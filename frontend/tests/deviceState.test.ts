import test from "node:test";
import assert from "node:assert/strict";

import { deviceIsActive, visibleControls } from "../src/shared/deviceState.ts";

const base: any = {
  id: 1,
  name: "TV",
  device_type: "tv",
  model: "generic",
  status: "off",
  capabilities: {
    controls: [
      { action: "power", label: "Power" },
      { action: "volume", label: "Volume" },
    ],
  },
};

test("deviceIsActive recognises powered/running state", () => {
  assert.equal(deviceIsActive({ ...base, state: { power: "on" } }), true);
  assert.equal(deviceIsActive({ ...base, state: { status: "running" } }), true);
  assert.equal(deviceIsActive(base), false);
});

test("visibleControls follows dashboard configuration", () => {
  assert.deepEqual(
    visibleControls({
      ...base,
      dashboard_card: {
        id: 1,
        device: 1,
        enabled: true,
        size: "medium",
        order: 0,
        visible_controls: ["volume"],
      },
    }).map((item) => item.action),
    ["volume"],
  );
});

test("legacy power selections map to the consolidated power toggle", () => {
  assert.deepEqual(
    visibleControls({
      ...base,
      dashboard_card: {
        id: 1,
        device: 1,
        enabled: true,
        size: "medium",
        order: 0,
        visible_controls: ["power_on", "power_off"],
      },
    }).map((item) => item.action),
    ["power"],
  );
});
