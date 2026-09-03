import { useEffect, useMemo, useState } from "react";
import { get, patch, post } from "../../shared/api/client";
import type { DashboardCard, Device } from "../../shared/types";
import { deviceIsActive, statusTone, visibleControls } from "../../shared/deviceState";
import ControlPanel from "../../shared/components/ControlPanel";
import DeviceModal from "../../shared/components/DeviceModal";
import Modal from "../../shared/components/Modal";

const span = {
  small: "col-span-1",
  medium: "col-span-1 xl:col-span-2",
  large: "col-span-2 xl:col-span-3",
};

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device | null>(null);
  const [customise, setCustomise] = useState<Device | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const current = await get<Device[]>("/devices/");
        const refreshed = await Promise.all(
          current.map(async (device) => {
            try {
              return (await post<{ device: Device }>(`/devices/${device.id}/refresh/`)).device;
            } catch {
              return device;
            }
          }),
        );
        if (!cancelled) setDevices(refreshed);
      } catch {
        // Keep the last-known state if the backend is temporarily unavailable.
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const shown = useMemo(
    () =>
      devices
        .filter((device) => device.dashboard_card?.enabled !== false)
        .sort((a, b) => (a.dashboard_card?.order ?? 0) - (b.dashboard_card?.order ?? 0)),
    [devices],
  );
  const updateDevice = (next: Device) =>
    setDevices((items) => items.map((item) => (item.id === next.id ? next : item)));
  const control = async (device: Device, action: string, parameters?: Record<string, unknown>) => {
    const result = await post<{ state: Record<string, unknown> }>(`/devices/${device.id}/control/`, {
      action,
      parameters,
    });
    updateDevice({ ...device, state: result.state, status: String(result.state.status || device.status) });
  };

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-bold text-white">Home</h1>
        <p className="mt-2 text-zinc-400">
          Your house at a glance. Each card is generated from the controls advertised by its device integration.
        </p>
      </header>
      {!shown.length ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-16 text-center text-zinc-500">
          Add a device from the Devices page and it will appear here automatically.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
          {shown.map((device) => {
            const size = device.dashboard_card?.size || "medium";
            const tone = statusTone(device);
            const active = deviceIsActive(device);
            return (
              <article
                key={device.id}
                className={`${span[size]} min-h-44 rounded-3xl border p-5 shadow-xl transition ${
                  tone === "active"
                    ? "border-emerald-500/40 bg-emerald-950/20"
                    : tone === "error"
                      ? "border-red-900 bg-red-950/20"
                      : "border-zinc-800 bg-zinc-900/80"
                }`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <button className="text-left" onClick={() => setSelected(device)}>
                    <div className="text-lg font-semibold text-white">{device.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
                      {device.device_type} · {String(device.state?.status || device.status)}
                    </div>
                  </button>
                  <div
                    className={`h-3 w-3 rounded-full ${
                      active ? "bg-emerald-400 shadow-[0_0_14px_#34d399]" : "bg-zinc-600"
                    }`}
                  />
                </div>
                <ControlPanel
                  compact
                  device={device}
                  controls={visibleControls(device)}
                  onControl={(action, params) => control(device, action, params)}
                />
                <div className="mt-4 flex gap-2 text-xs">
                  <button
                    onClick={() => setSelected(device)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-300 hover:border-cyan-500"
                  >
                    All controls
                  </button>
                  <button
                    onClick={() => setCustomise(device)}
                    className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-zinc-500 hover:text-white"
                  >
                    Customise
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <DeviceModal
        open={!!selected}
        device={selected}
        onClose={() => setSelected(null)}
        onChanged={(device) => {
          setSelected(device);
          updateDevice(device);
        }}
      />
      <CardSettings
        open={!!customise}
        device={customise}
        onClose={() => setCustomise(null)}
        onSaved={(device) => {
          updateDevice(device);
          setCustomise(null);
        }}
      />
    </div>
  );
}

function CardSettings({
  open,
  device,
  onClose,
  onSaved,
}: {
  open: boolean;
  device: Device | null;
  onClose: () => void;
  onSaved: (device: Device) => void;
}) {
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    if (device) {
      setSize(device.dashboard_card?.size || "medium");
      setVisible(device.dashboard_card?.visible_controls || []);
    }
  }, [device]);
  if (!device) return null;

  const all = device.capabilities?.controls || [];
  const save = async () => {
    if (!device.dashboard_card) return;
    const card = await patch<DashboardCard>(`/dashboard-cards/${device.dashboard_card.id}/`, {
      size,
      visible_controls: visible,
    });
    onSaved({ ...device, dashboard_card: card });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Customise ${device.name}`}>
      <div className="space-y-5">
        <label className="block text-sm text-zinc-400">
          Card size
          <select
            value={size}
            onChange={(event) => setSize(event.target.value as "small" | "medium" | "large")}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <div>
          <div className="mb-2 text-sm text-zinc-400">Controls shown on the card</div>
          <div className="grid gap-2 md:grid-cols-2">
            {all.map((control) => (
              <label key={control.action} className="flex items-center gap-2 rounded-lg border border-zinc-800 p-2 text-sm">
                <input
                  type="checkbox"
                  checked={visible.includes(control.action)}
                  onChange={(event) =>
                    setVisible(
                      event.target.checked
                        ? [...visible, control.action]
                        : visible.filter((value) => value !== control.action),
                    )
                  }
                />
                {control.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={save} className="rounded-lg bg-cyan-600 px-4 py-2 font-semibold">
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
