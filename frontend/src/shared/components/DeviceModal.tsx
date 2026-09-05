import { useEffect, useState } from "react";
import { apiUrl, post } from "../api/client";
import type { Device } from "../types";
import Modal from "./Modal";
import ControlPanel from "./ControlPanel";
import RingLiveView from "./RingLiveView";

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
  const [cameraError, setCameraError] = useState("");
  const [cameraSrc, setCameraSrc] = useState("");
  const [cameraLoading, setCameraLoading] = useState(false);
  const [liveView, setLiveView] = useState(false);

  useEffect(() => {
    setCurrent(device);
    setCameraError("");
    setLiveView(false);
    if (device?.device_type === "camera" || device?.state?.camera_available) {
      setFrameNonce((value) => value + 1);
    }
  }, [device]);
  useEffect(() => {
    const cameraDevice =
      current &&
      (current.device_type === "camera" ||
        Boolean(current.state?.camera_available));
    if (!open || !current?.id || !cameraDevice || liveView) return;

    let cancelled = false;
    let objectUrl = "";

    const loadCamera = async () => {
      setCameraLoading(true);
      setCameraError("");
      try {
        const response = await fetch(
          `${apiUrl(`/devices/${current.id}/camera-frame/`)}?t=${frameNonce}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          let message = `Camera request failed (${response.status})`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) message = payload.error;
          } catch {
            // Keep the HTTP status fallback when the upstream response is not JSON.
          }
          throw new Error(message);
        }

        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("image/")) {
          throw new Error("Ring returned a response, but it was not a camera image.");
        }

        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setCameraSrc(objectUrl);
      } catch (reason) {
        if (!cancelled) {
          setCameraSrc("");
          setCameraError(
            reason instanceof Error
              ? reason.message
              : "Could not load the Ring snapshot.",
          );
        }
      } finally {
        if (!cancelled) setCameraLoading(false);
      }
    };

    void loadCamera();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    open,
    current?.id,
    current?.device_type,
    current?.state?.camera_available,
    frameNonce,
    liveView,
  ]);

  useEffect(() => {
    if (!open || !device) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await post<{ device: Device }>(`/devices/${device.id}/refresh/`);
        if (!cancelled) {
          setCurrent(data.device);
          onChanged?.(data.device);
        }
      } catch {
        // Keep the last-known state when a device cannot be refreshed.
      }
    };
    void refresh();
    const cloudDevice =
      device.source === "cloud" ||
      device.model === "ring_camera" ||
      device.model === "hive_heating" ||
      device.model === "alexa_echo";
    const timer = window.setInterval(refresh, cloudDevice ? 15000 : 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, device?.id, device?.model, device?.source]);

  if (!current) return null;
  const control = async (action: string, parameters?: Record<string, unknown>) => {
    if (action === "snapshot") {
      setCameraError("");
      setCameraSrc("");
      setFrameNonce((value) => value + 1);
      return { state: current.state || {} };
    }

    const data = await post<{ state: Record<string, unknown> }>(`/devices/${current.id}/control/`, {
      action,
      parameters,
    });
    const next = { ...current, state: data.state, status: String(data.state?.status || current.status) };
    setCurrent(next);
    onChanged?.(next);
    return data;
  };
  const isCamera =
    current.device_type === "camera" || Boolean(current.state?.camera_available);
  const isRingCamera = current.model === "ring_camera";

  const closeModal = () => {
    setLiveView(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={closeModal} title={current.name} width="max-w-4xl">
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
          {isRingCamera && liveView ? (
            <RingLiveView
              device={current}
              onStop={() => setLiveView(false)}
            />
          ) : (
            <>
              {isCamera && (
                <div className="space-y-2">
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
                    {cameraSrc ? (
                      <img
                        className="h-full w-full object-contain"
                        src={cameraSrc}
                        alt={`${current.name} camera`}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
                        {cameraLoading
                          ? "Requesting a fresh Ring snapshot…"
                          : "No camera image loaded."}
                      </div>
                    )}
                    {cameraLoading && cameraSrc && (
                      <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-xs text-zinc-300">
                        Refreshing Ring snapshot…
                      </div>
                    )}
                  </div>
                  {cameraError && (
                    <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-300">
                      {cameraError}
                    </div>
                  )}
                </div>
              )}
              {isRingCamera && (
                <button
                  type="button"
                  onClick={() => setLiveView(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600"
                >
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  Live View
                </button>
              )}
            </>
          )}
          {!liveView && <ControlPanel device={current} onControl={control} />}
        </div>
      </div>
    </Modal>
  );
}
