import { useEffect, useState } from "react";
import { apiUrl, post } from "../api/client";
import type { Device } from "../types";
import Modal from "./Modal";
import ControlPanel from "./ControlPanel";

export default function DeviceModal({
  device,
  open,
  onClose,
  onChanged,
}: {
  device: Device | null;
  open: boolean;
  onClose: () => void;
  onChanged?: (device: Device) => void;
}) {
  const [current, setCurrent] = useState<Device | null>(device);
  const [frameNonce, setFrameNonce] = useState(0);

  useEffect(() => setCurrent(device), [device]);
  useEffect(() => {
    if (!open || !device) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await post<{ device: Device }>(`/devices/${device.id}/refresh/`);
        if (!cancelled) {
          setCurrent(data.device);
          onChanged?.(data.device);
          if (data.device.device_type === "camera" || data.device.state?.camera_available) {
            setFrameNonce((value) => value + 1);
          }
        }
      } catch {
        // Keep the last-known state when a device cannot be refreshed.
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, device?.id]);

  if (!current) return null;
  const control = async (action: string, parameters?: Record<string, unknown>) => {
    const data = await post<{ state: Record<string, unknown> }>(`/devices/${current.id}/control/`, {
      action,
      parameters,
    });
    const next = { ...current, state: data.state, status: String(data.state?.status || current.status) };
    setCurrent(next);
    onChanged?.(next);
    return data;
  };
  const isCamera = current.device_type === "camera" || Boolean(current.state?.camera_available);

  return (
    <Modal open={open} onClose={onClose} title={current.name} width="max-w-4xl">
      <div className="grid gap-5 md:grid-cols-[1fr_2fr]">
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 text-sm">
          <div><span className="text-zinc-500">Type:</span> <span className="text-white">{current.device_type}</span></div>
          <div><span className="text-zinc-500">Integration:</span> <span className="text-white">{current.model}</span></div>
          {current.ip_address && <div><span className="text-zinc-500">IP:</span> <span className="text-white">{current.ip_address}</span></div>}
          <div><span className="text-zinc-500">Status:</span> <span className={current.is_online ? "text-emerald-400" : "text-zinc-400"}>{String(current.state?.status || current.status)}</span></div>
          {current.state?.battery != null && <div><span className="text-zinc-500">Battery:</span> {String(current.state.battery)}%</div>}
          {current.state?.temperature != null && <div><span className="text-zinc-500">Temperature:</span> {String(current.state.temperature)}°C</div>}
          {current.state?.media?.title && <div><span className="text-zinc-500">Playing:</span> {String(current.state.media.title)}</div>}
        </div>
        <div className="space-y-5">
          {isCamera && (
            <img
              key={frameNonce}
              className="aspect-video w-full rounded-xl border border-zinc-800 bg-black object-contain"
              src={`${apiUrl(`/devices/${current.id}/camera-frame/`)}?t=${frameNonce}`}
              alt={`${current.name} camera`}
            />
          )}
          <ControlPanel device={current} onControl={control} />
        </div>
      </div>
    </Modal>
  );
}
