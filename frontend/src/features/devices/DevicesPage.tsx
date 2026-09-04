import { useEffect, useState } from "react";

import { get, post, remove } from "../../shared/api/client";
import DeviceModal from "../../shared/components/DeviceModal";
import type { Device, DiscoveryCandidate, DriverCatalog } from "../../shared/types";
import DeviceSetupWizard from "./DeviceSetupWizard";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [catalog, setCatalog] = useState<DriverCatalog>({});
  const [found, setFound] = useState<DiscoveryCandidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [cloudRefreshing, setCloudRefreshing] = useState(false);
  const [manualSetup, setManualSetup] = useState(false);
  const [candidateSetup, setCandidateSetup] = useState<DiscoveryCandidate | null>(null);
  const [existingSetup, setExistingSetup] = useState<Device | null>(null);
  const [selected, setSelected] = useState<Device | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const [nextDevices, nextCatalog] = await Promise.all([
      get<Device[]>("/devices/"),
      get<DriverCatalog>("/device-catalog/"),
    ]);
    setDevices(nextDevices);
    setCatalog(nextCatalog);
  };

  const mergeCandidates = (
    current: DiscoveryCandidate[],
    incoming: DiscoveryCandidate[],
  ) => {
    const merged = new Map<string, DiscoveryCandidate>();
    for (const candidate of [...current, ...incoming]) {
      const key =
        candidate.unique_id ||
        `${candidate.model}:${candidate.ip_address || candidate.name}`;
      merged.set(key, candidate);
    }
    return [...merged.values()];
  };

  const refreshCloud = async () => {
    setCloudRefreshing(true);
    try {
      const result = await get<{ devices: DiscoveryCandidate[] }>("/discovery/cloud/");
      setFound((current) => {
        const local = current.filter((candidate) => candidate.source !== "cloud");
        return mergeCandidates(local, result.devices);
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Cloud integration discovery failed",
      );
    } finally {
      setCloudRefreshing(false);
    }
  };

  useEffect(() => {
    void load().catch((reason: Error) => setError(reason.message));
    void refreshCloud();
  }, []);

  const scan = async () => {
    setScanning(true);
    setError("");
    try {
      const [network, cloud] = await Promise.all([
        post<{ devices: DiscoveryCandidate[] }>("/discovery/", { include_cloud: false }),
        get<{ devices: DiscoveryCandidate[] }>("/discovery/cloud/"),
      ]);
      setFound(mergeCandidates(network.devices, cloud.devices));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Device discovery failed");
    } finally {
      setScanning(false);
    }
  };

  const completeSetup = (device: Device) => {
    setDevices((current) => {
      const exists = current.some((item) => item.id === device.id);
      return exists
        ? current.map((item) => (item.id === device.id ? device : item))
        : [...current, device].sort((left, right) => left.name.localeCompare(right.name));
    });
    setFound((current) =>
      current.filter(
        (candidate) =>
          !device.unique_id || candidate.unique_id !== device.unique_id,
      ),
    );
    setManualSetup(false);
    setCandidateSetup(null);
    setExistingSetup(null);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Devices</h1>
          <p className="mt-2 max-w-3xl text-zinc-400">
            Discovery finds devices; setup connects them. HomeHub will guide you through any
            pairing, credentials or account linking each integration needs before adding it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void refreshCloud()}
            disabled={cloudRefreshing}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 disabled:opacity-50"
          >
            {cloudRefreshing ? "Refreshing cloud…" : "Refresh cloud devices"}
          </button>
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan local network"}
          </button>
          <button
            onClick={() => setManualSetup(true)}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm"
          >
            Manual add
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Discovered devices</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Choosing Set up does not add the device yet. You will complete its integration
              wizard and connection test first.
            </p>
          </div>
          {found.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400">
              {found.length} found
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {found.map((candidate) => (
            <div
              key={candidate.unique_id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{candidate.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {candidate.manufacturer || "Unknown manufacturer"} · {candidate.model} ·{" "}
                  {candidate.ip_address || "cloud account"}
                </div>
              </div>
              <button
                onClick={() => setCandidateSetup(candidate)}
                className="shrink-0 rounded-lg border border-cyan-800 px-3 py-2 text-sm text-cyan-300"
              >
                Set up
              </button>
            </div>
          ))}
          {!found.length && !scanning && (
            <div className="text-sm text-zinc-500">No unconfigured devices discovered.</div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="font-semibold">Configured devices</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Type</th>
                <th className="p-4">Integration</th>
                <th className="p-4">Status</th>
                <th className="p-4">Setup</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const needsSetup =
                  device.status === "error" || Boolean(device.state?.error);
                return (
                  <tr key={device.id} className="border-t border-zinc-800">
                    <td className="p-4">
                      <button
                        onClick={() => setSelected(device)}
                        className="font-medium hover:text-cyan-300"
                      >
                        {device.name}
                      </button>
                      <div className="text-xs text-zinc-600">{device.ip_address || "Cloud"}</div>
                    </td>
                    <td className="p-4">{device.device_type}</td>
                    <td className="p-4">{device.model}</td>
                    <td className="p-4">
                      <div className={needsSetup ? "text-red-400" : "text-zinc-300"}>
                        {String(device.state?.status || device.status)}
                      </div>
                      {device.state?.error && (
                        <div className="mt-1 max-w-xs truncate text-xs text-red-500" title={String(device.state.error)}>
                          {String(device.state.error)}
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => setExistingSetup(device)}
                        className={
                          needsSetup
                            ? "rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white"
                            : "rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:text-white"
                        }
                      >
                        {needsSetup ? "Finish setup" : "Reconfigure"}
                      </button>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={async () => {
                          await remove(`/devices/${device.id}/`);
                          setDevices((current) => current.filter((item) => item.id !== device.id));
                        }}
                        className="text-red-400"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <DeviceSetupWizard
        open={manualSetup}
        catalog={catalog}
        onClose={() => setManualSetup(false)}
        onComplete={completeSetup}
      />
      <DeviceSetupWizard
        open={Boolean(candidateSetup)}
        catalog={catalog}
        candidate={candidateSetup}
        onClose={() => setCandidateSetup(null)}
        onComplete={completeSetup}
      />
      <DeviceSetupWizard
        open={Boolean(existingSetup)}
        catalog={catalog}
        existing={existingSetup}
        onClose={() => setExistingSetup(null)}
        onComplete={completeSetup}
      />

      <DeviceModal
        open={Boolean(selected)}
        device={selected}
        onClose={() => setSelected(null)}
        onChanged={(device) => {
          setSelected(device);
          setDevices((current) =>
            current.map((item) => (item.id === device.id ? device : item)),
          );
        }}
      />
    </div>
  );
}
