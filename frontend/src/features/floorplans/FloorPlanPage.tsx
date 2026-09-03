import { useEffect, useMemo, useRef, useState } from "react";
import { get, patch, post, remove } from "../../shared/api/client";
import type { Device, FloorPlan, FloorPlanObject } from "../../shared/types";
import { deviceIsActive, statusTone } from "../../shared/deviceState";
import DeviceModal from "../../shared/components/DeviceModal";

const palette = [
  ["wall", "Wall", 180, 12], ["door", "Door", 90, 12], ["window", "Window", 100, 10],
  ["sofa", "Sofa", 130, 65], ["table", "Table", 100, 70], ["label", "Label", 120, 35],
] as const;

export default function FloorPlanPage() {
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deviceModal, setDeviceModal] = useState<Device | null>(null);
  const [newDeviceId, setNewDeviceId] = useState("");
  const [error, setError] = useState("");
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      let nextPlans = await get<FloorPlan[]>("/floor-plans/");
      if (!nextPlans.length) {
        nextPlans = [
          await post<FloorPlan>("/floor-plans/", {
            name: "Ground Floor",
            description: "",
            svg_data: "",
            width: 1200,
            height: 800,
          }),
        ];
      }
      const nextDevices = await get<Device[]>("/devices/");
      setPlans(nextPlans);
      setDevices(nextDevices);
      setPlanId((current) =>
        current && nextPlans.some((plan) => plan.id === current) ? current : nextPlans[0].id,
      );
    };
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
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
        setDevices(refreshed);
      } catch {
        // Keep the last-known floor-plan state.
      }
    };
    const timer = window.setInterval(refresh, 3500);
    return () => window.clearInterval(timer);
  }, []);

  const plan = plans.find((item) => item.id === planId) || null;
  const selected = plan?.objects.find((item) => item.id === selectedId) || null;
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const updateObjectLocal = (id: number, changes: Partial<FloorPlanObject>) =>
    setPlans((items) =>
      items.map((item) =>
        item.id === planId
          ? { ...item, objects: item.objects.map((object) => (object.id === id ? { ...object, ...changes } : object)) }
          : item,
      ),
    );

  const addObject = async (type: FloorPlanObject["object_type"], width: number, height: number, device?: number) => {
    if (!plan) return;
    const object = await post<FloorPlanObject>("/floor-plan-objects/", {
      floor_plan: plan.id,
      object_type: type,
      x: Math.max(20, plan.width / 2 - width / 2),
      y: Math.max(20, plan.height / 2 - height / 2),
      width,
      height,
      rotation: 0,
      z_index: 0,
      properties: type === "label" ? { label: "Label" } : {},
      device: device || null,
    });
    setPlans((items) =>
      items.map((item) => (item.id === plan.id ? { ...item, objects: [...item.objects, object] } : item)),
    );
    setSelectedId(object.id);
  };

  const saveObject = async (object: FloorPlanObject) => {
    try {
      await patch(`/floor-plan-objects/${object.id}/`, {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        properties: object.properties,
        device: object.device,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save floor-plan object");
    }
  };

  const createPlan = async () => {
    const name = window.prompt("Floor plan name", "First Floor");
    if (!name) return;
    const created = await post<FloorPlan>("/floor-plans/", {
      name,
      description: "",
      svg_data: "",
      width: 1200,
      height: 800,
    });
    setPlans([...plans, created]);
    setPlanId(created.id);
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Floor Plans</h1>
          <p className="mt-2 text-zinc-400">
            Draw the house, place devices, and control them directly from the plan. Movable devices use their reported live position when available.
          </p>
        </div>
        <button onClick={createPlan} className="rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-300">New floor</button>
      </header>
      {error && <div className="rounded-xl bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      <div className="flex gap-2 overflow-x-auto">
        {plans.map((item) => (
          <button
            key={item.id}
            onClick={() => { setPlanId(item.id); setSelectedId(null); }}
            className={`rounded-lg px-4 py-2 text-sm ${item.id === planId ? "bg-cyan-600 text-white" : "bg-zinc-900 text-zinc-400"}`}
          >
            {item.name}
          </button>
        ))}
      </div>
      {plan && (
        <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_260px]">
          <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Objects</h2>
            <div className="grid grid-cols-2 gap-2">
              {palette.map(([type, label, width, height]) => (
                <button key={type} onClick={() => addObject(type, width, height)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-3 text-xs hover:border-cyan-500">{label}</button>
              ))}
            </div>
            <div className="mt-5 border-t border-zinc-800 pt-4">
              <div className="mb-2 text-xs uppercase text-zinc-500">Device</div>
              <select value={newDeviceId} onChange={(event) => setNewDeviceId(event.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-xs">
                <option value="">Select device</option>
                {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
              <button disabled={!newDeviceId} onClick={() => { addObject("device", 70, 70, Number(newDeviceId)); setNewDeviceId(""); }} className="mt-2 w-full rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold disabled:opacity-40">Place device</button>
            </div>
          </aside>
          <div className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <svg
              viewBox={`0 0 ${plan.width} ${plan.height}`}
              onPointerMove={(event) => {
                if (!drag.current) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - rect.left) * plan.width / rect.width - drag.current.dx;
                const y = (event.clientY - rect.top) * plan.height / rect.height - drag.current.dy;
                updateObjectLocal(drag.current.id, { x: Math.max(0, Math.min(plan.width - 20, x)), y: Math.max(0, Math.min(plan.height - 20, y)) });
              }}
              onPointerUp={() => {
                if (!drag.current) return;
                const object = plan.objects.find((item) => item.id === drag.current?.id);
                drag.current = null;
                if (object) saveObject(object);
              }}
              className="aspect-[3/2] w-full min-w-[750px] select-none rounded-xl bg-zinc-900 shadow-inner"
              style={{ touchAction: "none" }}
            >
              {plan.objects.map((object) => (
                <ObjectShape
                  key={object.id}
                  obj={object}
                  device={object.device ? deviceById.get(object.device) : undefined}
                  selected={object.id === selectedId}
                  onDown={(event, item) => {
                    const svg = event.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    const rect = svg.getBoundingClientRect();
                    const point = { x: (event.clientX - rect.left) * plan.width / rect.width, y: (event.clientY - rect.top) * plan.height / rect.height };
                    drag.current = { id: item.id, dx: point.x - item.x, dy: point.y - item.y };
                    setSelectedId(item.id);
                  }}
                  onOpen={setDeviceModal}
                />
              ))}
            </svg>
          </div>
          <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            {selected ? (
              <Inspector
                obj={selected}
                device={selected.device ? deviceById.get(selected.device) : undefined}
                onChange={(changes) => updateObjectLocal(selected.id, changes)}
                onSave={() => {
                  const current = plan.objects.find((item) => item.id === selected.id);
                  if (current) saveObject(current);
                }}
                onDelete={async () => {
                  await remove(`/floor-plan-objects/${selected.id}/`);
                  setPlans((items) => items.map((item) => item.id === plan.id ? { ...item, objects: item.objects.filter((object) => object.id !== selected.id) } : item));
                  setSelectedId(null);
                }}
                onOpen={setDeviceModal}
              />
            ) : <div className="text-sm text-zinc-500">Select an object to edit its size, rotation and properties.</div>}
          </aside>
        </div>
      )}
      <DeviceModal open={!!deviceModal} device={deviceModal} onClose={() => setDeviceModal(null)} onChanged={(device) => { setDeviceModal(device); setDevices((items) => items.map((item) => item.id === device.id ? device : item)); }} />
    </div>
  );
}

function ObjectShape({ obj, device, selected, onDown, onOpen }: { obj: FloorPlanObject; device?: Device; selected: boolean; onDown: (event: React.PointerEvent<SVGElement>, object: FloorPlanObject) => void; onOpen: (device: Device) => void }) {
  const location = device?.state?.location;
  const moving = obj.object_type === "device" && location && Number.isFinite(location.x) && Number.isFinite(location.y);
  const x = moving ? Number(location.x) : obj.x;
  const y = moving ? Number(location.y) : obj.y;
  const transform = `rotate(${obj.rotation} ${x + obj.width / 2} ${y + obj.height / 2})`;
  const tone = device ? statusTone(device) : "inactive";
  const deviceFill = tone === "active" ? "#065f46" : tone === "error" ? "#7f1d1d" : "#3f3f46";
  const stroke = selected ? "#22d3ee" : "#71717a";
  const common = { onPointerDown: (event: React.PointerEvent<SVGElement>) => onDown(event, obj), onDoubleClick: () => device && onOpen(device), style: { cursor: "move" } };
  if (obj.object_type === "wall") return <rect {...common} x={x} y={y} width={obj.width} height={obj.height} transform={transform} fill="#a1a1aa" stroke={stroke} strokeWidth={selected ? 3 : 1} />;
  if (obj.object_type === "door") return <g {...common} transform={transform}><rect x={x} y={y} width={obj.width} height={obj.height} fill="#a16207" stroke={stroke} /><path d={`M ${x} ${y} Q ${x + obj.width / 2} ${y - obj.width / 2} ${x + obj.width} ${y}`} fill="none" stroke="#d97706" strokeWidth="3" /></g>;
  if (obj.object_type === "window") return <g {...common} transform={transform}><rect x={x} y={y} width={obj.width} height={obj.height} fill="#0e7490" stroke={stroke} /><line x1={x + obj.width / 2} y1={y} x2={x + obj.width / 2} y2={y + obj.height} stroke="#67e8f9" /></g>;
  if (obj.object_type === "sofa") return <g {...common} transform={transform}><rect x={x} y={y} rx="14" width={obj.width} height={obj.height} fill="#52525b" stroke={stroke} /><rect x={x + 8} y={y + 8} rx="10" width={obj.width - 16} height={obj.height / 2} fill="#71717a" /></g>;
  if (obj.object_type === "table") return <rect {...common} x={x} y={y} rx="8" width={obj.width} height={obj.height} transform={transform} fill="#713f12" stroke={stroke} />;
  if (obj.object_type === "label") return <text {...common} x={x} y={y + 24} transform={transform} fill="#d4d4d8" stroke={selected ? stroke : "none"}>{obj.properties?.label || "Label"}</text>;
  return <g {...common} transform={transform}><rect x={x} y={y} rx="18" width={obj.width} height={obj.height} fill={deviceFill} stroke={selected ? "#22d3ee" : device && deviceIsActive(device) ? "#34d399" : "#71717a"} strokeWidth={selected ? 4 : 2} /><text x={x + obj.width / 2} y={y + obj.height / 2 - 4} textAnchor="middle" fill="white" fontSize="12">{device?.name?.slice(0, 12) || "Device"}</text><text x={x + obj.width / 2} y={y + obj.height / 2 + 14} textAnchor="middle" fill="#d4d4d8" fontSize="9">{String(device?.state?.status || device?.status || "")}</text></g>;
}

function Inspector({ obj, device, onChange, onSave, onDelete, onOpen }: { obj: FloorPlanObject; device?: Device; onChange: (changes: Partial<FloorPlanObject>) => void; onSave: () => void; onDelete: () => void; onOpen: (device: Device) => void }) {
  return <div className="space-y-3"><h2 className="font-semibold capitalize">{device?.name || obj.object_type}</h2>{(["x", "y", "width", "height", "rotation"] as const).map((key) => <label key={key} className="block text-xs capitalize text-zinc-500">{key}<input type="number" value={obj[key]} onChange={(event) => onChange({ [key]: Number(event.target.value) })} onBlur={onSave} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm text-white" /></label>)}{obj.object_type === "label" && <label className="block text-xs text-zinc-500">Text<input value={String(obj.properties?.label || "")} onChange={(event) => onChange({ properties: { ...obj.properties, label: event.target.value } })} onBlur={onSave} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm text-white" /></label>}{device && <><div className="rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400"><div>Status: {String(device.state?.status || device.status)}</div>{device.state?.battery != null && <div>Battery: {String(device.state.battery)}%</div>}{device.state?.location && <div>Live: {Math.round(Number(device.state.location.x))}, {Math.round(Number(device.state.location.y))}</div>}</div><button onClick={() => onOpen(device)} className="w-full rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-300">Open controls</button></>}<button onClick={onDelete} className="w-full rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300">Delete object</button></div>;
}
