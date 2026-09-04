import type { ControlDescriptor, Device } from "./types";

export function deviceIsActive(device: Device) {
  const status = String(device.state?.status || device.status || "").toLowerCase();
  const power = device.state?.power;
  return (
    status === "on" ||
    status === "running" ||
    power === true ||
    power === "on"
  );
}

export function statusTone(
  device: Device,
): "active" | "inactive" | "error" | "unknown" {
  const status = String(
    device.state?.status || device.status || "unknown",
  ).toLowerCase();
  if (status === "error") return "error";
  if (deviceIsActive(device)) return "active";
  if (status === "off" || status === "idle") return "inactive";
  return "unknown";
}

const CONTROL_ALIASES: Record<string, string[]> = {
  power: ["power_on", "power_off"],
  mute: ["set_mute", "unmute"],
  lights: ["lights_on", "lights_off"],
  siren: ["siren_on", "siren_off"],
};

export function visibleControls(device: Device): ControlDescriptor[] {
  const all = device.capabilities?.controls || [];
  const selected = device.dashboard_card?.visible_controls || [];
  if (!selected.length) return all.slice(0, 4);

  const filtered = all.filter(
    (control) =>
      selected.includes(control.action) ||
      (CONTROL_ALIASES[control.action] || []).some((alias) =>
        selected.includes(alias),
      ),
  );

  return filtered.length ? filtered : all.slice(0, 4);
}
