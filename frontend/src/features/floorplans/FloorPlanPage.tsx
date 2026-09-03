import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { get, patch, post, remove } from "../../shared/api/client";
import type { Device, FloorPlan, FloorPlanObject, FloorPlanObjectType, Room } from "../../shared/types";
import { deviceIsActive, statusTone } from "../../shared/deviceState";
import DeviceModal from "../../shared/components/DeviceModal";
import { floorPlanPalette, paletteCategories, roomPresets } from "./floorPlanCatalog";
import type { PaletteItem, RoomPreset } from "./floorPlanCatalog";
import {
  clamp,
  collectSnapPoints,
  GRID_SIZE,
  MIN_OBJECT_SIZE,
  resizeRect,
  snapOpeningToRooms,
  snapPoint,
  snapRoomPosition,
  wallEndPoint,
  wallFromEndpoints,
} from "./floorPlanGeometry";
import type { SnapGuide } from "./floorPlanGeometry";

type Selection = { kind: "room" | "object"; id: number } | null;
type ResizeHandle = "nw" | "ne" | "se" | "sw";
type Interaction =
  | { kind: "move-room"; id: number; start: Point; origin: Room }
  | { kind: "resize-room"; id: number; handle: ResizeHandle; origin: Room }
  | { kind: "move-object"; id: number; start: Point; origin: FloorPlanObject }
  | { kind: "resize-object"; id: number; handle: ResizeHandle; origin: FloorPlanObject }
  | { kind: "wall-end"; id: number; end: "start" | "end"; origin: FloorPlanObject };

type Point = { x: number; y: number };

const OPENING_TYPES = new Set<FloorPlanObjectType>(["door", "window", "radiator", "fireplace"]);
const NON_RESIZABLE = new Set<FloorPlanObjectType>(["column", "plant", "lamp", "device"]);

export default function FloorPlanPage() {
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [deviceModal, setDeviceModal] = useState<Device | null>(null);
  const [newDeviceId, setNewDeviceId] = useState("");
  const [error, setError] = useState("");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteCategory, setPaletteCategory] = useState<"All" | (typeof paletteCategories)[number]>("All");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [libraryTab, setLibraryTab] = useState<"rooms" | "objects" | "devices">("rooms");
  const interaction = useRef<Interaction | null>(null);
  const planRef = useRef<FloorPlan | null>(null);

  const plan = plans.find((item) => item.id === planId) || null;
  planRef.current = plan;

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
      setPlans(nextPlans);
      setDevices(await get<Device[]>("/devices/"));
      setPlanId((current) =>
        current && nextPlans.some((item) => item.id === current) ? current : nextPlans[0].id,
      );
    };
    void load().catch((reason: Error) => setError(reason.message));
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
        // Preserve last-known state if one or more integrations are temporarily offline.
      }
    };
    const timer = window.setInterval(refresh, 3500);
    return () => window.clearInterval(timer);
  }, []);

  const selectedRoom = selection?.kind === "room" ? plan?.rooms.find((room) => room.id === selection.id) || null : null;
  const selectedObject = selection?.kind === "object" ? plan?.objects.find((object) => object.id === selection.id) || null : null;
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const filteredPalette = useMemo(() => {
    const term = paletteSearch.trim().toLowerCase();
    return floorPlanPalette.filter(
      (item) =>
        (paletteCategory === "All" || item.category === paletteCategory) &&
        (!term || item.label.toLowerCase().includes(term) || item.category.toLowerCase().includes(term)),
    );
  }, [paletteCategory, paletteSearch]);

  const updateRoomLocal = (id: number, changes: Partial<Room>) =>
    setPlans((items) =>
      items.map((item) =>
        item.id === planId
          ? { ...item, rooms: item.rooms.map((room) => (room.id === id ? { ...room, ...changes } : room)) }
          : item,
      ),
    );

  const updateObjectLocal = (id: number, changes: Partial<FloorPlanObject>) =>
    setPlans((items) =>
      items.map((item) =>
        item.id === planId
          ? { ...item, objects: item.objects.map((object) => (object.id === id ? { ...object, ...changes } : object)) }
          : item,
      ),
    );

  const saveRoom = async (room: Room) => {
    await patch(`/rooms/${room.id}/`, {
      name: room.name,
      description: room.description || "",
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height,
      rotation: room.rotation,
      z_index: room.z_index,
      properties: room.properties,
    });
  };

  const saveObject = async (object: FloorPlanObject) => {
    await patch(`/floor-plan-objects/${object.id}/`, {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      rotation: object.rotation,
      z_index: object.z_index,
      properties: object.properties,
      device: object.device || null,
    });
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
    setPlans((items) => [...items, created]);
    setPlanId(created.id);
    setSelection(null);
  };

  const addRoom = async (preset: RoomPreset) => {
    if (!plan) return;
    const sameType = plan.rooms.filter((room) => room.properties?.room_type === preset.properties.room_type).length;
    const suffix = sameType ? ` ${sameType + 1}` : "";
    const room = await post<Room>("/rooms/", {
      floor_plan: plan.id,
      name: `${preset.label}${suffix}`,
      description: "",
      x: 40 + ((plan.rooms.length * 30) % 180),
      y: 40 + ((plan.rooms.length * 30) % 140),
      width: preset.width,
      height: preset.height,
      rotation: 0,
      z_index: -100,
      properties: preset.properties,
    });
    setPlans((items) => items.map((item) => (item.id === plan.id ? { ...item, rooms: [...item.rooms, room] } : item)));
    setSelection({ kind: "room", id: room.id });
  };

  const addObject = async (item: PaletteItem, device?: number) => {
    if (!plan) return;
    const object = await post<FloorPlanObject>("/floor-plan-objects/", {
      floor_plan: plan.id,
      object_type: item.type,
      x: Math.max(20, plan.width / 2 - item.width / 2),
      y: Math.max(20, plan.height / 2 - item.height / 2),
      width: item.width,
      height: item.height,
      rotation: 0,
      z_index: item.type === "rug" ? -10 : 10,
      properties: item.type === "label" ? { label: "Label" } : {},
      device: device || null,
    });
    setPlans((items) => items.map((current) => (current.id === plan.id ? { ...current, objects: [...current.objects, object] } : current)));
    setSelection({ kind: "object", id: object.id });
  };

  const addDevice = async () => {
    const device = devices.find((item) => item.id === Number(newDeviceId));
    if (!device) return;
    await addObject({ type: "device", label: device.name, category: "Living", width: 62, height: 62 }, device.id);
    setNewDeviceId("");
  };

  const deleteSelection = async (target: Selection) => {
    if (!plan || !target) return;
    if (target.kind === "room") {
      await remove(`/rooms/${target.id}/`);
      setPlans((items) => items.map((item) => (item.id === plan.id ? { ...item, rooms: item.rooms.filter((room) => room.id !== target.id) } : item)));
    } else {
      await remove(`/floor-plan-objects/${target.id}/`);
      setPlans((items) => items.map((item) => (item.id === plan.id ? { ...item, objects: item.objects.filter((object) => object.id !== target.id) } : item)));
    }
    setSelection(null);
  };

  const duplicateSelection = async () => {
    if (!plan || !selection) return;
    if (selection.kind === "room" && selectedRoom) {
      const room = await post<Room>("/rooms/", {
        floor_plan: plan.id,
        name: `${selectedRoom.name} copy`,
        description: selectedRoom.description || "",
        x: selectedRoom.x + 30,
        y: selectedRoom.y + 30,
        width: selectedRoom.width,
        height: selectedRoom.height,
        rotation: selectedRoom.rotation,
        z_index: selectedRoom.z_index,
        properties: selectedRoom.properties,
      });
      setPlans((items) => items.map((item) => (item.id === plan.id ? { ...item, rooms: [...item.rooms, room] } : item)));
      setSelection({ kind: "room", id: room.id });
      return;
    }
    if (selection.kind === "object" && selectedObject) {
      const object = await post<FloorPlanObject>("/floor-plan-objects/", {
        floor_plan: plan.id,
        object_type: selectedObject.object_type,
        x: selectedObject.x + 25,
        y: selectedObject.y + 25,
        width: selectedObject.width,
        height: selectedObject.height,
        rotation: selectedObject.rotation,
        z_index: selectedObject.z_index,
        properties: selectedObject.properties,
        device: selectedObject.device || null,
      });
      setPlans((items) => items.map((item) => (item.id === plan.id ? { ...item, objects: [...item.objects, object] } : item)));
      setSelection({ kind: "object", id: object.id });
    }
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "Escape") setSelection(null);
      if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        void deleteSelection(selection);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selection) {
        event.preventDefault();
        void duplicateSelection();
      }
      if (selection && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const delta = {
          ArrowLeft: { x: -amount, y: 0 },
          ArrowRight: { x: amount, y: 0 },
          ArrowUp: { x: 0, y: -amount },
          ArrowDown: { x: 0, y: amount },
        }[event.key]!;
        if (selection.kind === "room" && selectedRoom) {
          const next = { ...selectedRoom, x: selectedRoom.x + delta.x, y: selectedRoom.y + delta.y };
          updateRoomLocal(selectedRoom.id, next);
          void saveRoom(next);
        }
        if (selection.kind === "object" && selectedObject) {
          const next = { ...selectedObject, x: selectedObject.x + delta.x, y: selectedObject.y + delta.y };
          updateObjectLocal(selectedObject.id, next);
          void saveObject(next);
        }
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [selection, selectedRoom, selectedObject]);

  const pointFromEvent = (event: ReactPointerEvent<SVGElement>) => {
    const currentPlan = planRef.current;
    if (!currentPlan) return { x: 0, y: 0 };
    const svg = event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget.ownerSVGElement;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * currentPlan.width) / rect.width,
      y: ((event.clientY - rect.top) * currentPlan.height) / rect.height,
    };
  };

  const begin = (event: ReactPointerEvent<SVGElement>, next: Interaction) => {
    event.stopPropagation();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    interaction.current = next;
  };

  const roomWallTargets = (objects: FloorPlanObject[]) => {
    const x: number[] = [];
    const y: number[] = [];
    for (const object of objects.filter((item) => item.object_type === "wall")) {
      const end = wallEndPoint(object);
      x.push(object.x, end.x);
      y.push(object.y, end.y);
    }
    return { x, y };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const currentPlan = planRef.current;
    const current = interaction.current;
    if (!currentPlan || !current) return;
    const pointer = pointFromEvent(event);

    if (current.kind === "move-room") {
      const candidate = {
        ...current.origin,
        x: current.origin.x + pointer.x - current.start.x,
        y: current.origin.y + pointer.y - current.start.y,
      };
      const snapped = snapRoomPosition(candidate, currentPlan.rooms, currentPlan, snapEnabled, roomWallTargets(currentPlan.objects));
      updateRoomLocal(current.id, snapped.value);
      setGuides(snapped.guides);
      return;
    }

    if (current.kind === "resize-room") {
      const resized = resizeRect(current.origin, current.handle, pointer, currentPlan.rooms, currentPlan, snapEnabled, 80, roomWallTargets(currentPlan.objects));
      updateRoomLocal(current.id, resized.value);
      setGuides(resized.guides);
      return;
    }

    if (current.kind === "wall-end") {
      const walls = currentPlan.objects.filter((item) => item.object_type === "wall");
      const snapped = snapPoint(pointer, collectSnapPoints(currentPlan.rooms, walls, current.id), snapEnabled);
      const start = { x: current.origin.x, y: current.origin.y };
      const end = wallEndPoint(current.origin);
      const next = current.end === "start"
        ? wallFromEndpoints(snapped.value, end, current.origin.height)
        : wallFromEndpoints(start, snapped.value, current.origin.height);
      updateObjectLocal(current.id, next);
      setGuides(snapped.guides);
      return;
    }

    if (current.kind === "move-object") {
      const dx = pointer.x - current.start.x;
      const dy = pointer.y - current.start.y;
      let next = {
        ...current.origin,
        x: current.origin.x + dx,
        y: current.origin.y + dy,
      };
      if (current.origin.object_type === "wall") {
        const walls = currentPlan.objects.filter((item) => item.object_type === "wall");
        const snapped = snapPoint({ x: next.x, y: next.y }, collectSnapPoints(currentPlan.rooms, walls, current.id), snapEnabled);
        next = { ...next, x: snapped.value.x, y: snapped.value.y };
        setGuides(snapped.guides);
      } else {
        if (snapEnabled) {
          next.x = Math.round(next.x / GRID_SIZE) * GRID_SIZE;
          next.y = Math.round(next.y / GRID_SIZE) * GRID_SIZE;
        }
        if (OPENING_TYPES.has(next.object_type)) next = { ...next, ...snapOpeningToRooms(next, currentPlan.rooms, snapEnabled) };
        next.x = clamp(next.x, 0, Math.max(0, currentPlan.width - next.width));
        next.y = clamp(next.y, 0, Math.max(0, currentPlan.height - next.height));
      }
      updateObjectLocal(current.id, next);
      return;
    }

    if (current.kind === "resize-object") {
      const resized = resizeRect(current.origin, current.handle, pointer, [], currentPlan, snapEnabled, MIN_OBJECT_SIZE);
      updateObjectLocal(current.id, resized.value);
      setGuides(resized.guides);
    }
  };

  const finishInteraction = async () => {
    const current = interaction.current;
    interaction.current = null;
    setGuides([]);
    if (!current) return;
    const latest = planRef.current;
    if (!latest) return;
    try {
      if (current.kind === "move-room" || current.kind === "resize-room") {
        const room = latest.rooms.find((item) => item.id === current.id);
        if (room) await saveRoom(room);
      } else {
        const object = latest.objects.find((item) => item.id === current.id);
        if (object) await saveObject(object);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save floor-plan changes");
    }
  };

  const changeSelectedRoom = async (changes: Partial<Room>) => {
    if (!selectedRoom) return;
    const next = { ...selectedRoom, ...changes };
    updateRoomLocal(selectedRoom.id, changes);
    try {
      await saveRoom(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save room");
    }
  };

  const changeSelectedObject = async (changes: Partial<FloorPlanObject>) => {
    if (!selectedObject) return;
    const next = { ...selectedObject, ...changes };
    updateObjectLocal(selectedObject.id, changes);
    try {
      await saveObject(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save object");
    }
  };

  if (!plan) return <div className="text-zinc-400">Loading floor plans…</div>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Floor Plan Designer</h1>
          <p className="mt-2 max-w-3xl text-zinc-400">
            Build the house room-by-room, snap spaces together, furnish them, then layer live HomeHub devices on top.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={plan.id}
            onChange={(event) => { setPlanId(Number(event.target.value)); setSelection(null); }}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            {plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button onClick={() => void createPlan()} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">New floor</button>
          <button onClick={() => setSnapEnabled((value) => !value)} className={`rounded-lg border px-3 py-2 text-sm ${snapEnabled ? "border-cyan-600 bg-cyan-950/40 text-cyan-200" : "border-zinc-700"}`}>
            Snap {snapEnabled ? "on" : "off"}
          </button>
          <button onClick={() => setGridVisible((value) => !value)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Grid</button>
          <button onClick={() => setZoom((value) => Math.max(.5, value - .1))} className="rounded-lg border border-zinc-700 px-3 py-2">−</button>
          <span className="w-14 text-center text-xs text-zinc-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(2.2, value + .1))} className="rounded-lg border border-zinc-700 px-3 py-2">+</button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}

      <div className="grid min-h-[720px] gap-4 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="grid grid-cols-3 rounded-xl bg-zinc-950 p-1 text-xs">
            {(["rooms", "objects", "devices"] as const).map((tab) => (
              <button key={tab} onClick={() => setLibraryTab(tab)} className={`rounded-lg px-2 py-2 capitalize ${libraryTab === tab ? "bg-zinc-800 text-white" : "text-zinc-500"}`}>{tab}</button>
            ))}
          </div>

          {libraryTab === "rooms" && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-white">Create rooms</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Rooms include their perimeter walls. Drag a room or its corner handles and adjacent edges snap together.</p>
              <div className="mt-3 grid gap-2">
                {roomPresets.map((preset) => (
                  <button key={preset.label} onClick={() => void addRoom(preset)} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5 text-left hover:border-cyan-700">
                    <span className="text-sm text-zinc-200">{preset.label}</span>
                    <span className="text-[10px] text-zinc-600">{preset.width}×{preset.height}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {libraryTab === "objects" && (
            <div className="mt-4">
              <input value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder="Search objects…" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
              <div className="mt-2 flex max-h-20 flex-wrap gap-1 overflow-auto">
                <button onClick={() => setPaletteCategory("All")} className={`rounded-md px-2 py-1 text-[10px] ${paletteCategory === "All" ? "bg-cyan-900 text-cyan-100" : "bg-zinc-800 text-zinc-400"}`}>All</button>
                {paletteCategories.map((category) => (
                  <button key={category} onClick={() => setPaletteCategory(category)} className={`rounded-md px-2 py-1 text-[10px] ${paletteCategory === category ? "bg-cyan-900 text-cyan-100" : "bg-zinc-800 text-zinc-400"}`}>{category}</button>
                ))}
              </div>
              <div className="mt-3 grid max-h-[560px] gap-2 overflow-auto pr-1">
                {filteredPalette.map((item, index) => (
                  <button key={`${item.type}-${item.category}-${index}`} onClick={() => void addObject(item)} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5 text-left hover:border-cyan-700">
                    <ObjectLibraryIcon type={item.type} />
                    <span className="min-w-0"><span className="block text-sm text-zinc-200">{item.label}</span><span className="block text-[10px] text-zinc-600">{item.category}</span></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {libraryTab === "devices" && (
            <div className="mt-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-white">HomeHub devices</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">Place a linked device on the plan. Its state and controls remain live.</p>
              </div>
              <select value={newDeviceId} onChange={(event) => setNewDeviceId(event.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm">
                <option value="">Select a device…</option>
                {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
              <button disabled={!newDeviceId} onClick={() => void addDevice()} className="w-full rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold disabled:opacity-40">Place device</button>
              <div className="space-y-2 pt-2">
                {devices.map((device) => (
                  <div key={device.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <div className="flex items-center justify-between"><span className="text-sm text-zinc-200">{device.name}</span><span className={`h-2.5 w-2.5 rounded-full ${deviceIsActive(device) ? "bg-emerald-400" : "bg-zinc-600"}`} /></div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">{device.device_type} · {String(device.state?.status || device.status)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        <main className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="mx-auto origin-top-left" style={{ width: `${zoom * 100}%`, minWidth: 620 }}>
            <svg
              viewBox={`0 0 ${plan.width} ${plan.height}`}
              className="w-full touch-none select-none rounded-lg bg-[#111315] shadow-2xl"
              onPointerMove={handlePointerMove}
              onPointerUp={() => void finishInteraction()}
              onPointerCancel={() => void finishInteraction()}
              onPointerDown={() => setSelection(null)}
            >
              <defs>
                <pattern id="smallGrid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                  <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#27272a" strokeWidth="0.7" />
                </pattern>
                <pattern id="grid" width={GRID_SIZE * 5} height={GRID_SIZE * 5} patternUnits="userSpaceOnUse">
                  <rect width={GRID_SIZE * 5} height={GRID_SIZE * 5} fill="url(#smallGrid)" />
                  <path d={`M ${GRID_SIZE * 5} 0 L 0 0 0 ${GRID_SIZE * 5}`} fill="none" stroke="#3f3f46" strokeWidth="1" />
                </pattern>
              </defs>
              {gridVisible && <rect width="100%" height="100%" fill="url(#grid)" />}

              {plan.rooms.map((room) => (
                <RoomShape
                  key={room.id}
                  room={room}
                  selected={selection?.kind === "room" && selection.id === room.id}
                  onSelect={(event) => {
                    setSelection({ kind: "room", id: room.id });
                    begin(event, { kind: "move-room", id: room.id, start: pointFromEvent(event), origin: room });
                  }}
                  onResize={(event, handle) => {
                    setSelection({ kind: "room", id: room.id });
                    begin(event, { kind: "resize-room", id: room.id, handle, origin: room });
                  }}
                />
              ))}

              {plan.objects.map((object) => {
                const device = object.device ? deviceById.get(object.device) : undefined;
                return (
                  <ObjectShape
                    key={object.id}
                    object={object}
                    device={device}
                    selected={selection?.kind === "object" && selection.id === object.id}
                    onSelect={(event) => {
                      setSelection({ kind: "object", id: object.id });
                      begin(event, { kind: "move-object", id: object.id, start: pointFromEvent(event), origin: object });
                    }}
                    onResize={(event, handle) => begin(event, { kind: "resize-object", id: object.id, handle, origin: object })}
                    onWallEnd={(event, end) => begin(event, { kind: "wall-end", id: object.id, end, origin: object })}
                    onOpenDevice={() => device && setDeviceModal(device)}
                  />
                );
              })}

              {guides.map((guide, index) => guide.axis === "x"
                ? <line key={`${guide.axis}-${index}`} x1={guide.value} y1={0} x2={guide.value} y2={plan.height} stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="8 8" opacity=".8" />
                : <line key={`${guide.axis}-${index}`} x1={0} y1={guide.value} x2={plan.width} y2={guide.value} stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="8 8" opacity=".8" />)}
            </svg>
          </div>
        </main>

        <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          {!selection && (
            <div>
              <h2 className="font-semibold text-white">Inspector</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Select a room, wall, furnishing or device. Drag items to position them and drag blue corner handles to resize.</p>
              <div className="mt-5 rounded-xl bg-zinc-950 p-3 text-xs leading-6 text-zinc-500">
                <div><span className="text-zinc-300">Delete</span> remove selection</div>
                <div><span className="text-zinc-300">Ctrl/Cmd + D</span> duplicate</div>
                <div><span className="text-zinc-300">Arrow keys</span> nudge 1 unit</div>
                <div><span className="text-zinc-300">Shift + arrows</span> nudge 10</div>
              </div>
            </div>
          )}

          {selectedRoom && (
            <RoomInspector
              room={selectedRoom}
              onChange={(changes) => void changeSelectedRoom(changes)}
              onDuplicate={() => void duplicateSelection()}
              onDelete={() => void deleteSelection(selection)}
            />
          )}

          {selectedObject && (
            <ObjectInspector
              object={selectedObject}
              device={selectedObject.device ? deviceById.get(selectedObject.device) : undefined}
              onChange={(changes) => void changeSelectedObject(changes)}
              onDuplicate={() => void duplicateSelection()}
              onDelete={() => void deleteSelection(selection)}
              onOpenDevice={() => {
                const device = selectedObject.device ? deviceById.get(selectedObject.device) : undefined;
                if (device) setDeviceModal(device);
              }}
            />
          )}
        </aside>
      </div>

      <DeviceModal
        open={!!deviceModal}
        device={deviceModal}
        onClose={() => setDeviceModal(null)}
        onChanged={(device) => {
          setDeviceModal(device);
          setDevices((items) => items.map((item) => item.id === device.id ? device : item));
        }}
      />
    </div>
  );
}

function RoomShape({ room, selected, onSelect, onResize }: {
  room: Room;
  selected: boolean;
  onSelect: (event: ReactPointerEvent<SVGElement>) => void;
  onResize: (event: ReactPointerEvent<SVGElement>, handle: ResizeHandle) => void;
}) {
  const wall = Number(room.properties?.wall_thickness || 14);
  const fill = roomFill(String(room.properties?.room_type || "room"));
  return (
    <g>
      <rect
        x={room.x}
        y={room.y}
        width={room.width}
        height={room.height}
        rx="2"
        fill={fill}
        stroke={selected ? "#22d3ee" : "#d4d4d8"}
        strokeWidth={selected ? wall + 3 : wall}
        className="cursor-move"
        onPointerDown={onSelect}
      />
      <text x={room.x + room.width / 2} y={room.y + room.height / 2 - 4} textAnchor="middle" fill="#e4e4e7" fontSize="18" pointerEvents="none">{room.name}</text>
      <text x={room.x + room.width / 2} y={room.y + room.height / 2 + 18} textAnchor="middle" fill="#71717a" fontSize="11" pointerEvents="none">{Math.round(room.width)} × {Math.round(room.height)}</text>
      {selected && <>
        <DimensionLine x1={room.x} y1={room.y - 20} x2={room.x + room.width} y2={room.y - 20} label={`${Math.round(room.width)}`} />
        <DimensionLine x1={room.x - 20} y1={room.y} x2={room.x - 20} y2={room.y + room.height} label={`${Math.round(room.height)}`} vertical />
        {cornerHandles(room).map(({ key, x, y }) => <ResizeHandleCircle key={key} x={x} y={y} onPointerDown={(event) => onResize(event, key)} />)}
      </>}
    </g>
  );
}

function ObjectShape({ object, device, selected, onSelect, onResize, onWallEnd, onOpenDevice }: {
  object: FloorPlanObject;
  device?: Device;
  selected: boolean;
  onSelect: (event: ReactPointerEvent<SVGElement>) => void;
  onResize: (event: ReactPointerEvent<SVGElement>, handle: ResizeHandle) => void;
  onWallEnd: (event: ReactPointerEvent<SVGElement>, end: "start" | "end") => void;
  onOpenDevice: () => void;
}) {
  if (object.object_type === "wall") {
    const end = wallEndPoint(object);
    return <g>
      <line x1={object.x} y1={object.y} x2={end.x} y2={end.y} stroke={selected ? "#22d3ee" : "#e4e4e7"} strokeWidth={object.height} strokeLinecap="square" className="cursor-move" onPointerDown={onSelect} />
      {selected && <>
        <circle cx={object.x} cy={object.y} r="9" fill="#22d3ee" stroke="#083344" strokeWidth="3" className="cursor-crosshair" onPointerDown={(event) => { event.stopPropagation(); onWallEnd(event, "start"); }} />
        <circle cx={end.x} cy={end.y} r="9" fill="#22d3ee" stroke="#083344" strokeWidth="3" className="cursor-crosshair" onPointerDown={(event) => { event.stopPropagation(); onWallEnd(event, "end"); }} />
        <DimensionLine x1={object.x} y1={object.y - 18} x2={end.x} y2={end.y - 18} label={`${Math.round(object.width)}`} />
      </>}
    </g>;
  }

  const tone = device ? statusTone(device) : "inactive";
  const active = device ? deviceIsActive(device) : false;
  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;
  const canResize = !NON_RESIZABLE.has(object.object_type);
  return (
    <g transform={`rotate(${object.rotation} ${cx} ${cy})`}>
      <g className="cursor-move" onPointerDown={onSelect} onDoubleClick={(event) => { if (device) { event.stopPropagation(); onOpenDevice(); } }}>
        <ObjectGlyph object={object} active={active} tone={tone} device={device} selected={selected} />
      </g>
      {selected && <>
        <rect x={object.x - 5} y={object.y - 5} width={object.width + 10} height={object.height + 10} fill="none" stroke="#22d3ee" strokeWidth="2" strokeDasharray="7 5" pointerEvents="none" />
        {canResize && cornerHandles(object).map(({ key, x, y }) => <ResizeHandleCircle key={key} x={x} y={y} onPointerDown={(event) => { event.stopPropagation(); onResize(event, key); }} />)}
      </>}
    </g>
  );
}

function ObjectGlyph({ object, active, tone, device, selected }: { object: FloorPlanObject; active: boolean; tone: string; device?: Device; selected: boolean }) {
  const { x, y, width: w, height: h } = object;
  const stroke = selected ? "#22d3ee" : "#a1a1aa";
  const fill = tone === "active" ? "#064e3b" : tone === "error" ? "#450a0a" : "#27272a";
  const common = { stroke, strokeWidth: 2, fill };
  const type = object.object_type;

  if (type === "door") return <><line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#d4d4d8" strokeWidth="5" /><path d={`M ${x} ${y + h / 2} A ${w} ${w} 0 0 1 ${x + w} ${y + h / 2 - w}`} fill="none" stroke="#71717a" strokeWidth="2" /></>;
  if (type === "window") return <><line x1={x} y1={y + h / 2 - 3} x2={x + w} y2={y + h / 2 - 3} stroke="#67e8f9" strokeWidth="3" /><line x1={x} y1={y + h / 2 + 3} x2={x + w} y2={y + h / 2 + 3} stroke="#67e8f9" strokeWidth="3" /></>;
  if (type === "stairs") return <><rect x={x} y={y} width={w} height={h} {...common} />{Array.from({ length: 8 }).map((_, index) => <line key={index} x1={x} y1={y + (h / 8) * index} x2={x + w} y2={y + (h / 8) * index} stroke="#71717a" strokeWidth="1.5" />)}<path d={`M ${x + w / 2} ${y + h - 12} L ${x + w / 2} ${y + 14}`} stroke="#22d3ee" strokeWidth="2" /></>;
  if (type === "rug") return <rect x={x} y={y} width={w} height={h} rx="8" fill="#3f3f46" stroke="#52525b" strokeWidth="2" strokeDasharray="5 4" />;
  if (type === "plant") return <><circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2 - 2} fill="#14532d" stroke="#4ade80" strokeWidth="2" /><path d={`M ${x + w / 2} ${y + h * .2} L ${x + w / 2} ${y + h * .8} M ${x + w * .25} ${y + h * .45} L ${x + w * .75} ${y + h * .55}`} stroke="#86efac" strokeWidth="2" /></>;
  if (type === "lamp") return <><circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2 - 2} fill="#713f12" stroke="#facc15" strokeWidth="2" /><circle cx={x + w / 2} cy={y + h / 2} r="5" fill="#fde047" /></>;
  if (type === "bed") return <><rect x={x} y={y} width={w} height={h} rx="8" {...common} /><rect x={x + 8} y={y + 8} width={w - 16} height={Math.min(42, h * .25)} rx="6" fill="#52525b" /><line x1={x + w / 2} y1={y + 8} x2={x + w / 2} y2={y + Math.min(50, h * .3)} stroke="#71717a" /></>;
  if (type === "sofa" || type === "armchair") return <><rect x={x} y={y} width={w} height={h} rx="12" {...common} /><rect x={x + 7} y={y + 8} width={w - 14} height={Math.max(10, h * .27)} rx="7" fill="#52525b" /><line x1={x + w * .2} y1={y + h * .4} x2={x + w * .2} y2={y + h * .9} stroke="#71717a" /><line x1={x + w * .8} y1={y + h * .4} x2={x + w * .8} y2={y + h * .9} stroke="#71717a" /></>;
  if (["dining_table", "coffee_table", "side_table", "patio_table"].includes(type)) return <rect x={x} y={y} width={w} height={h} rx={type === "dining_table" ? 8 : 14} {...common} />;
  if (["dining_chair", "office_chair", "garden_chair"].includes(type)) return <><rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx="7" {...common} /><line x1={x + 5} y1={y + 7} x2={x + w - 5} y2={y + 7} stroke="#71717a" strokeWidth="4" /></>;
  if (type === "toilet") return <><ellipse cx={x + w / 2} cy={y + h * .58} rx={w * .34} ry={h * .32} {...common} /><rect x={x + w * .2} y={y} width={w * .6} height={h * .27} rx="5" {...common} /></>;
  if (type === "bath") return <><rect x={x} y={y} width={w} height={h} rx={h / 2} {...common} /><rect x={x + 9} y={y + 9} width={w - 18} height={h - 18} rx={(h - 18) / 2} fill="#164e63" stroke="#67e8f9" /></>;
  if (type === "shower") return <><rect x={x} y={y} width={w} height={h} {...common} /><circle cx={x + w / 2} cy={y + h / 2} r="8" fill="#164e63" stroke="#67e8f9" /><path d={`M ${x + 8} ${y + 8} L ${x + w - 8} ${y + h - 8} M ${x + w - 8} ${y + 8} L ${x + 8} ${y + h - 8}`} stroke="#52525b" /></>;
  if (type === "sink" || type === "vanity") return <><rect x={x} y={y} width={w} height={h} rx="5" {...common} /><ellipse cx={x + w / 2} cy={y + h / 2} rx={w * .3} ry={h * .25} fill="#164e63" stroke="#67e8f9" /></>;
  if (type === "hob") return <><rect x={x} y={y} width={w} height={h} {...common} />{[[.3,.3],[.7,.3],[.3,.7],[.7,.7]].map(([px,py], index) => <circle key={index} cx={x + w * px} cy={y + h * py} r={Math.min(w,h)*.12} fill="none" stroke="#71717a" strokeWidth="2" />)}</>;
  if (["oven", "fridge", "freezer", "dishwasher", "washing_machine", "dryer", "microwave", "boiler", "appliance"].includes(type)) return <><rect x={x} y={y} width={w} height={h} rx="5" {...common} />{(type === "washing_machine" || type === "dryer") && <circle cx={x + w / 2} cy={y + h * .55} r={Math.min(w,h)*.27} fill="#18181b" stroke="#71717a" strokeWidth="3" />}<text x={x + w / 2} y={y + 14} fill="#a1a1aa" fontSize="9" textAnchor="middle">{shortLabel(type)}</text></>;
  if (["wardrobe", "chest_drawers", "bedside_table", "dresser", "bookshelf", "cabinet", "storage_unit", "kitchen_counter", "kitchen_island", "desk", "tv_stand"].includes(type)) return <><rect x={x} y={y} width={w} height={h} rx="4" {...common} /><line x1={x + w / 2} y1={y + 4} x2={x + w / 2} y2={y + h - 4} stroke="#52525b" /></>;
  if (type === "radiator") return <><rect x={x} y={y} width={w} height={h} rx="3" fill="#3f3f46" stroke={stroke} strokeWidth="2" />{Array.from({ length: 7 }).map((_, index) => <line key={index} x1={x + (w / 8) * (index + 1)} y1={y + 3} x2={x + (w / 8) * (index + 1)} y2={y + h - 3} stroke="#71717a" />)}</>;
  if (type === "fireplace") return <><rect x={x} y={y} width={w} height={h} {...common} /><path d={`M ${x + w * .35} ${y + h * .8} Q ${x + w * .5} ${y + h * .15} ${x + w * .65} ${y + h * .8}`} fill="#7c2d12" stroke="#fb923c" /></>;
  if (type === "barbecue") return <><rect x={x} y={y + h * .25} width={w} height={h * .55} rx="8" {...common} /><line x1={x + w * .2} y1={y + h * .8} x2={x + w * .15} y2={y + h} stroke="#71717a" strokeWidth="3" /><line x1={x + w * .8} y1={y + h * .8} x2={x + w * .85} y2={y + h} stroke="#71717a" strokeWidth="3" /></>;
  if (type === "column") return <rect x={x} y={y} width={w} height={h} rx="3" fill="#52525b" stroke={stroke} strokeWidth="3" />;
  if (type === "label") return <text x={x} y={y + h * .7} fill="#d4d4d8" fontSize={Math.max(12, h * .55)}>{String(object.properties?.label || "Label")}</text>;
  if (type === "device") return <><rect x={x} y={y} width={w} height={h} rx="16" fill={active ? "#064e3b" : "#27272a"} stroke={active ? "#34d399" : stroke} strokeWidth="3" /><circle cx={x + w - 10} cy={y + 10} r="4" fill={active ? "#34d399" : "#71717a"} /><text x={x + w / 2} y={y + h / 2 - 2} textAnchor="middle" fill="#f4f4f5" fontSize="10">{device?.name || "Device"}</text><text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fill="#71717a" fontSize="8">{device?.device_type || "smart"}</text></>;
  return <><rect x={x} y={y} width={w} height={h} rx="5" {...common} /><text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="#a1a1aa" fontSize="10">{shortLabel(type)}</text></>;
}

function RoomInspector({ room, onChange, onDuplicate, onDelete }: { room: Room; onChange: (changes: Partial<Room>) => void; onDuplicate: () => void; onDelete: () => void }) {
  return <div className="space-y-4">
    <div><div className="text-[10px] uppercase tracking-[.2em] text-cyan-500">Room</div><input value={room.name} onChange={(event) => onChange({ name: event.target.value })} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-lg font-semibold" /></div>
    <div className="rounded-xl bg-zinc-950 p-3 text-xs text-zinc-400">Drag any blue corner on the canvas to resize. The room will snap to neighbouring room edges and corners.</div>
    <div className="grid grid-cols-2 gap-2"><NumberField label="Width" value={room.width} onChange={(value) => onChange({ width: value })} /><NumberField label="Height" value={room.height} onChange={(value) => onChange({ height: value })} /></div>
    <div className="grid grid-cols-2 gap-2"><NumberField label="X" value={room.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={room.y} onChange={(value) => onChange({ y: value })} /></div>
    <NumberField label="Wall thickness" value={Number(room.properties?.wall_thickness || 14)} onChange={(value) => onChange({ properties: { ...room.properties, wall_thickness: value } })} />
    <div className="flex gap-2"><button onClick={onDuplicate} className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm">Duplicate</button><button onClick={onDelete} className="flex-1 rounded-lg border border-red-900 px-3 py-2 text-sm text-red-400">Delete</button></div>
  </div>;
}

function ObjectInspector({ object, device, onChange, onDuplicate, onDelete, onOpenDevice }: { object: FloorPlanObject; device?: Device; onChange: (changes: Partial<FloorPlanObject>) => void; onDuplicate: () => void; onDelete: () => void; onOpenDevice: () => void }) {
  return <div className="space-y-4">
    <div><div className="text-[10px] uppercase tracking-[.2em] text-cyan-500">{object.object_type.replaceAll("_", " ")}</div><div className="mt-1 text-lg font-semibold text-white">{device?.name || shortLabel(object.object_type)}</div></div>
    {device && <button onClick={onOpenDevice} className="w-full rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold">Open device controls</button>}
    {object.object_type === "label" && <label className="block text-xs text-zinc-500">Text<input value={String(object.properties?.label || "")} onChange={(event) => onChange({ properties: { ...object.properties, label: event.target.value } })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm text-white" /></label>}
    {object.object_type !== "wall" && <div className="grid grid-cols-2 gap-2"><NumberField label="Width" value={object.width} onChange={(value) => onChange({ width: value })} /><NumberField label="Height" value={object.height} onChange={(value) => onChange({ height: value })} /></div>}
    {object.object_type === "wall" && <div className="grid grid-cols-2 gap-2"><NumberField label="Length" value={object.width} onChange={(value) => onChange({ width: value })} /><NumberField label="Thickness" value={object.height} onChange={(value) => onChange({ height: value })} /></div>}
    <div className="grid grid-cols-2 gap-2"><NumberField label="X" value={object.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={object.y} onChange={(value) => onChange({ y: value })} /></div>
    <NumberField label="Rotation" value={object.rotation} onChange={(value) => onChange({ rotation: value })} />
    <div className="flex gap-2"><button onClick={onDuplicate} className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm">Duplicate</button><button onClick={onDelete} className="flex-1 rounded-lg border border-red-900 px-3 py-2 text-sm text-red-400">Delete</button></div>
  </div>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-[10px] uppercase tracking-wide text-zinc-500">{label}<input type="number" value={Math.round(value * 10) / 10} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm text-white" /></label>;
}

function ResizeHandleCircle({ x, y, onPointerDown }: { x: number; y: number; onPointerDown: (event: ReactPointerEvent<SVGCircleElement>) => void }) {
  return <circle cx={x} cy={y} r="9" fill="#22d3ee" stroke="#083344" strokeWidth="3" className="cursor-nwse-resize" onPointerDown={onPointerDown} />;
}

function DimensionLine({ x1, y1, x2, y2, label, vertical = false }: { x1: number; y1: number; x2: number; y2: number; label: string; vertical?: boolean }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return <g pointerEvents="none"><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#22d3ee" strokeWidth="1.2" /><line x1={vertical ? x1 - 5 : x1} y1={vertical ? y1 : y1 - 5} x2={vertical ? x1 + 5 : x1} y2={vertical ? y1 : y1 + 5} stroke="#22d3ee" /><line x1={vertical ? x2 - 5 : x2} y1={vertical ? y2 : y2 - 5} x2={vertical ? x2 + 5 : x2} y2={vertical ? y2 : y2 + 5} stroke="#22d3ee" /><rect x={mx - 20} y={my - 9} width="40" height="18" rx="5" fill="#083344" /><text x={mx} y={my + 4} textAnchor="middle" fill="#67e8f9" fontSize="10">{label}</text></g>;
}

function ObjectLibraryIcon({ type }: { type: FloorPlanObjectType }) {
  return <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-[9px] font-semibold uppercase text-cyan-300">{iconText(type)}</div>;
}

function cornerHandles(rect: { x: number; y: number; width: number; height: number }) {
  return [
    { key: "nw" as const, x: rect.x, y: rect.y },
    { key: "ne" as const, x: rect.x + rect.width, y: rect.y },
    { key: "se" as const, x: rect.x + rect.width, y: rect.y + rect.height },
    { key: "sw" as const, x: rect.x, y: rect.y + rect.height },
  ];
}

function roomFill(type: string) {
  const fills: Record<string, string> = {
    living: "#17212a",
    kitchen: "#1f2320",
    dining: "#211f1a",
    bedroom: "#201c26",
    bathroom: "#17242a",
    hall: "#202020",
    office: "#1a2027",
    utility: "#22201c",
  };
  return fills[type] || "#1c1c1f";
}

function iconText(type: FloorPlanObjectType) {
  const names: Partial<Record<FloorPlanObjectType, string>> = {
    wall: "W", door: "DR", window: "WN", stairs: "ST", column: "CL", radiator: "RAD", fireplace: "FP", boiler: "BLR",
    sofa: "SO", armchair: "AC", coffee_table: "CT", side_table: "ST", dining_table: "DT", dining_chair: "DC", tv_stand: "TV", bookshelf: "BK",
    bed: "BED", wardrobe: "WR", chest_drawers: "CD", bedside_table: "BT", dresser: "DS",
    kitchen_counter: "KC", kitchen_island: "KI", sink: "SNK", oven: "OV", hob: "HOB", fridge: "FR", freezer: "FZ", dishwasher: "DW", washing_machine: "WM", dryer: "TD", microwave: "MW",
    toilet: "WC", bath: "BA", shower: "SH", vanity: "VN", desk: "DK", office_chair: "OC", cabinet: "CB", storage_unit: "SU", rug: "RG", plant: "PL", lamp: "LP", patio_table: "PT", garden_chair: "GC", barbecue: "BBQ", label: "TXT", device: "DEV", appliance: "APP",
  };
  return names[type] || type.slice(0, 3).toUpperCase();
}

function shortLabel(type: FloorPlanObjectType | string) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}
