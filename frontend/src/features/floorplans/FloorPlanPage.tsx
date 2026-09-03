import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { get, patch, post, remove } from "../../shared/api/client";
import type { Device, FloorPlan, FloorPlanObject, FloorPlanObjectType, Room } from "../../shared/types";
import { deviceIsActive, statusTone } from "../../shared/deviceState";
import DeviceModal from "../../shared/components/DeviceModal";
import { floorPlanPalette, paletteCategories } from "./floorPlanCatalog";
import {
  clamp,
  collectSnapPoints,
  GRID_SIZE,
  MIN_OBJECT_SIZE,
  resizeRect,
  snapPoint,
  snapRoomPosition,
  wallEndPoint,
  wallFromEndpoints,
} from "./floorPlanGeometry";

type Selection = { kind: "room" | "object"; id: number } | null;
type ResizeHandle = "nw" | "ne" | "se" | "sw";
type Interaction =
  | { kind: "move-room"; id: number; start: { x: number; y: number }; origin: Room }
  | { kind: "resize-room"; id: number; handle: ResizeHandle; origin: Room }
  | { kind: "move-object"; id: number; start: { x: number; y: number }; origin: FloorPlanObject }
  | { kind: "resize-object"; id: number; handle: ResizeHandle; origin: FloorPlanObject }
  | { kind: "wall-end"; id: number; end: "start" | "end"; origin: FloorPlanObject };

const OPENING_TYPES = new Set<FloorPlanObjectType>(["door", "window", "radiator", "fireplace"]);

export default function FloorPlanPage() {
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [deviceModal, setDeviceModal] = useState<Device | null>(null);
  const [newDeviceId, setNewDeviceId] = useState("");
  const [error, setError] = useState("");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteCategory, setPaletteCategory] = useState<(typeof paletteCategories)[number] | "All">("All");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [zoom, setZoom] = useState(1);
  const interaction = useRef<Interaction | null>(null);

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
        // Keep the last-known floor-plan state while a device or backend is unavailable.
      }
    };
    const timer = window.setInterval(refresh, 3500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selection || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") setSelection(null);
      if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        void deleteSelection(selection);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const plan = plans.find((item) => item.id === planId) || null;
  const selectedRoom =
    selection?.kind === "room" ? plan?.rooms.find((item) => item.id === selection.id) || null : null;
  const selectedObject =
    selection?.kind === "object" ? plan?.objects.find((item) => item.id === selection.id) || null : null;
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const filteredPalette = useMemo(() => {
    const term = paletteSearch.trim().toLowerCase();
    return floorPlanPalette.filter(
      (item) =>
        (paletteCategory === "All" || item.category === paletteCategory) &&
        (!term || item.label.toLowerCase().includes(term)),
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
          ? {
              ...item,
              objects: item.objects.map((object) => (object.id === id ? { ...object, ...changes } : object)),
            }
          : item,
      ),
    );

  const saveRoom = async (room: Room) => {
    try {
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save room");
    }
  };

  const saveObject = async (object: FloorPlanObject) => {
    try {
      await patch(`/floor-plan-objects/${object.id}/`, {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        z_index: object.z_index,
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
    setPlans((items) => [...items, created]);
    setPlanId(created.id);
    setSelection(null);
  };

  const addRoom = async () => {
    if (!plan) return;
    const index = plan.rooms.length + 1;
    const offset = ((index - 1) % 5) * 30;
    const room = await post<Room>("/rooms/", {
      floor_plan: plan.id,
      name: `Room ${index}`,
      description: "",
      x: 50 + offset,
      y: 50 + offset,
      width: 320,
      height: 240,
      rotation: 0,
      z_index: -100,
      properties: { wall_thickness: 12 },
    });
    setPlans((items) =>
      items.map((item) => (item.id === plan.id ? { ...item, rooms: [...item.rooms, room] } : item)),
    );
    setSelection({ kind: "room", id: room.id });
  };

  const addObject = async (
    type: FloorPlanObjectType,
    width: number,
    height: number,
    device?: number,
  ) => {
    if (!plan) return;
    const object = await post<FloorPlanObject>("/floor-plan-objects/", {
      floor_plan: plan.id,
      object_type: type,
      x: Math.max(20, plan.width / 2 - width / 2),
      y: Math.max(20, plan.height / 2 - height / 2),
      width,
      height,
      rotation: 0,
      z_index: type === "rug" ? -10 : 0,
      properties: type === "label" ? { label: "Label" } : {},
      device: device || null,
    });
    setPlans((items) =>
      items.map((item) => (item.id === plan.id ? { ...item, objects: [...item.objects, object] } : item)),
    );
    setSelection({ kind: "object", id: object.id });
  };

  const deleteSelection = async (target: Selection) => {
    if (!plan || !target) return;
    if (target.kind === "room") {
      await remove(`/rooms/${target.id}/`);
      setPlans((items) =>
        items.map((item) =>
          item.id === plan.id ? { ...item, rooms: item.rooms.filter((room) => room.id !== target.id) } : item,
        ),
      );
    } else {
      await remove(`/floor-plan-objects/${target.id}/`);
      setPlans((items) =>
        items.map((item) =>
          item.id === plan.id
            ? { ...item, objects: item.objects.filter((object) => object.id !== target.id) }
            : item,
        ),
      );
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
      setPlans((items) =>
        items.map((item) => (item.id === plan.id ? { ...item, rooms: [...item.rooms, room] } : item)),
      );
      setSelection({ kind: "room", id: room.id });
    } else if (selection.kind === "object" && selectedObject) {
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
      setPlans((items) =>
        items.map((item) => (item.id === plan.id ? { ...item, objects: [...item.objects, object] } : item)),
      );
      setSelection({ kind: "object", id: object.id });
    }
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!plan) return { x: 0, y: 0 };
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * plan.width) / rect.width,
      y: ((event.clientY - rect.top) * plan.height) / rect.height,
    };
  };

  const startInteraction = (event: ReactPointerEvent<SVGElement>, next: Interaction) => {
    event.stopPropagation();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    interaction.current = next;
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!plan || !interaction.current) return;
    const pointer = pointFromEvent(event);
    const current = interaction.current;

    if (current.kind === "move-room") {
      const candidate = {
        ...current.origin,
        x: current.origin.x + pointer.x - current.start.x,
        y: current.origin.y + pointer.y - current.start.y,
      };
      updateRoomLocal(
        current.id,
        snapRoomPosition(
          candidate,
          plan.rooms,
          { width: plan.width, height: plan.height },
          snapEnabled,
          roomGuidesFromWalls(plan.objects),
        ),
      );
      return;
    }

    if (current.kind === "resize-room") {
      updateRoomLocal(
        current.id,
        resizeRect(
          current.origin,
          current.handle,
          pointer,
          plan.rooms,
          { width: plan.width, height: plan.height },
          snapEnabled,
          undefined,
          roomGuidesFromWalls(plan.objects),
        ),
      );
      return;
    }

    if (current.kind === "wall-end") {
      const walls = plan.objects.filter((item) => item.object_type === "wall") as (FloorPlanObject & {
        rotation: number;
      })[];
      const targets = collectSnapPoints(plan.rooms, walls, current.id);
      const snapped = snapPoint(pointer, targets, snapEnabled);
      const start = { x: current.origin.x, y: current.origin.y };
      const end = wallEndPoint(current.origin);
      const next =
        current.end === "start"
          ? wallFromEndpoints(snapped, end, current.origin.height)
          : wallFromEndpoints(start, snapped, current.origin.height);
      updateObjectLocal(current.id, next);
      return;
    }

    if (current.kind === "move-object") {
      const dx = pointer.x - current.start.x;
      const dy = pointer.y - current.start.y;
      let x = current.origin.x + dx;
      let y = current.origin.y + dy;

      if (current.origin.object_type === "wall") {
        const walls = plan.objects.filter((item) => item.object_type === "wall") as (FloorPlanObject & {
          rotation: number;
        })[];
        const targets = collectSnapPoints(plan.rooms, walls, current.id);
        const snapped = snapPoint({ x, y }, targets, snapEnabled);
        x = snapped.x;
        y = snapped.y;
      } else {
        if (snapEnabled) {
          x = Math.round(x / GRID_SIZE) * GRID_SIZE;
          y = Math.round(y / GRID_SIZE) * GRID_SIZE;
        }
        const opening = snapOpeningToRoom(
          { ...current.origin, x, y },
          plan.rooms,
          snapEnabled && OPENING_TYPES.has(current.origin.object_type),
        );
        x = opening.x;
        y = opening.y;
        if (opening.rotation !== undefined) updateObjectLocal(current.id, { rotation: opening.rotation });
      }
      updateObjectLocal(current.id, {
        x: clamp(x, 0, Math.max(0, plan.width - current.origin.width)),
        y: clamp(y, 0, Math.max(0, plan.height - current.origin.height)),
      });
      return;
    }

    if (current.kind === "resize-object") {
      updateObjectLocal(
        current.id,
        resizeRect(
          current.origin,
          current.handle,
          pointer,
          plan.rooms,
          { width: plan.width, height: plan.height },
          snapEnabled,
          MIN_OBJECT_SIZE,
        ),
      );
    }
  };

  const finishInteraction = () => {
    if (!plan || !interaction.current) return;
    const current = interaction.current;
    interaction.current = null;
    if (current.kind === "move-room" || current.kind === "resize-room") {
      const room = plan.rooms.find((item) => item.id === current.id);
      if (room) void saveRoom(room);
    } else {
      const object = plan.objects.find((item) => item.id === current.id);
      if (object) void saveObject(object);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Floor Plans</h1>
          <p className="mt-2 max-w-4xl text-zinc-400">
            Build the floor plan first, then layer HomeHub devices onto it. Rooms and wall endpoints snap together,
            and selected rooms or furniture can be resized directly from their corner handles.
          </p>
        </div>
        <button
          onClick={createPlan}
          className="rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-300"
        >
          New floor
        </button>
      </header>

      {error && <div className="rounded-xl bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}

      <div className="flex gap-2 overflow-x-auto">
        {plans.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setPlanId(item.id);
              setSelection(null);
            }}
            className={`rounded-lg px-4 py-2 text-sm ${
              item.id === planId ? "bg-cyan-600 text-white" : "bg-zinc-900 text-zinc-400"
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>

      {plan && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
            <button onClick={addRoom} className="rounded-lg bg-cyan-700 px-3 py-2 font-semibold text-white">
              + Room
            </button>
            <button
              onClick={() => {
                const wall = floorPlanPalette.find((item) => item.type === "wall");
                if (wall) void addObject("wall", wall.width, wall.height);
              }}
              className="rounded-lg border border-zinc-700 px-3 py-2"
            >
              + Wall
            </button>
            <span className="mx-1 h-6 w-px bg-zinc-800" />
            <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
              <input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} />
              Snap
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
              <input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)} />
              Grid
            </label>
            <span className="text-zinc-500">Grid {GRID_SIZE}px</span>
            <span className="ml-auto text-zinc-500">Zoom</span>
            <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.5, 2))} className="rounded border border-zinc-700 px-2 py-1">
              −
            </button>
            <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.5, 2))} className="rounded border border-zinc-700 px-2 py-1">
              +
            </button>
            {selection && (
              <>
                <button onClick={() => void duplicateSelection()} className="rounded border border-zinc-700 px-3 py-2">
                  Duplicate
                </button>
                <button onClick={() => void deleteSelection(selection)} className="rounded border border-red-900 px-3 py-2 text-red-400">
                  Delete
                </button>
              </>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)_280px]">
            <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Library</h2>
              <input
                value={paletteSearch}
                onChange={(event) => setPaletteSearch(event.target.value)}
                placeholder="Search objects"
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <select
                value={paletteCategory}
                onChange={(event) => setPaletteCategory(event.target.value as typeof paletteCategory)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                <option value="All">All categories</option>
                {paletteCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
              <div className="mt-3 grid max-h-[540px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                {filteredPalette.map((item, index) => (
                  <button
                    key={`${item.type}-${item.category}-${index}`}
                    onClick={() => void addObject(item.type, item.width, item.height)}
                    className="min-h-14 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-left text-xs hover:border-cyan-500"
                  >
                    <span className="block font-medium text-zinc-200">{item.label}</span>
                    <span className="mt-1 block text-[10px] text-zinc-600">{item.category}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 border-t border-zinc-800 pt-4">
                <div className="mb-2 text-xs uppercase text-zinc-500">HomeHub device</div>
                <select
                  value={newDeviceId}
                  onChange={(event) => setNewDeviceId(event.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-xs"
                >
                  <option value="">Select device</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!newDeviceId}
                  onClick={() => {
                    void addObject("device", 70, 70, Number(newDeviceId));
                    setNewDeviceId("");
                  }}
                  className="mt-2 w-full rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                >
                  Place device
                </button>
              </div>
            </aside>

            <div className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div style={{ width: `${zoom * 100}%`, minWidth: 760 }}>
                <svg
                  viewBox={`0 0 ${plan.width} ${plan.height}`}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishInteraction}
                  onPointerCancel={finishInteraction}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) setSelection(null);
                  }}
                  className="aspect-[3/2] w-full select-none rounded-xl bg-zinc-900 shadow-inner"
                  style={{ touchAction: "none" }}
                >
                  <defs>
                    <pattern id="floor-grid-small" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                      <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#27272a" strokeWidth="0.7" />
                    </pattern>
                    <pattern id="floor-grid-large" width={GRID_SIZE * 5} height={GRID_SIZE * 5} patternUnits="userSpaceOnUse">
                      <rect width={GRID_SIZE * 5} height={GRID_SIZE * 5} fill="url(#floor-grid-small)" />
                      <path d={`M ${GRID_SIZE * 5} 0 L 0 0 0 ${GRID_SIZE * 5}`} fill="none" stroke="#3f3f46" strokeWidth="1" />
                    </pattern>
                  </defs>
                  {gridVisible && <rect width={plan.width} height={plan.height} fill="url(#floor-grid-large)" />}

                  {plan.rooms.map((room) => (
                    <RoomShape
                      key={room.id}
                      room={room}
                      selected={selection?.kind === "room" && selection.id === room.id}
                      onMoveStart={(event) => {
                        setSelection({ kind: "room", id: room.id });
                        startInteraction(event, {
                          kind: "move-room",
                          id: room.id,
                          start: pointFromChildEvent(event, plan),
                          origin: { ...room },
                        });
                      }}
                      onResizeStart={(event, handle) =>
                        startInteraction(event, {
                          kind: "resize-room",
                          id: room.id,
                          handle,
                          origin: { ...room },
                        })
                      }
                      onSelect={() => setSelection({ kind: "room", id: room.id })}
                    />
                  ))}

                  {plan.objects.map((object) => (
                    <ObjectShape
                      key={object.id}
                      obj={object}
                      device={object.device ? deviceById.get(object.device) : undefined}
                      selected={selection?.kind === "object" && selection.id === object.id}
                      onMoveStart={(event) => {
                        setSelection({ kind: "object", id: object.id });
                        startInteraction(event, {
                          kind: "move-object",
                          id: object.id,
                          start: pointFromChildEvent(event, plan),
                          origin: { ...object },
                        });
                      }}
                      onResizeStart={(event, handle) =>
                        startInteraction(event, {
                          kind: "resize-object",
                          id: object.id,
                          handle,
                          origin: { ...object },
                        })
                      }
                      onWallEndStart={(event, end) =>
                        startInteraction(event, {
                          kind: "wall-end",
                          id: object.id,
                          end,
                          origin: { ...object },
                        })
                      }
                      onSelect={() => setSelection({ kind: "object", id: object.id })}
                      onOpen={setDeviceModal}
                    />
                  ))}
                </svg>
              </div>
            </div>

            <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              {selectedRoom ? (
                <RoomInspector
                  room={selectedRoom}
                  onChange={(changes) => updateRoomLocal(selectedRoom.id, changes)}
                  onSave={() => {
                    const current = plan.rooms.find((item) => item.id === selectedRoom.id);
                    if (current) void saveRoom(current);
                  }}
                />
              ) : selectedObject ? (
                <ObjectInspector
                  obj={selectedObject}
                  device={selectedObject.device ? deviceById.get(selectedObject.device) : undefined}
                  onChange={(changes) => updateObjectLocal(selectedObject.id, changes)}
                  onSave={() => {
                    const current = plan.objects.find((item) => item.id === selectedObject.id);
                    if (current) void saveObject(current);
                  }}
                  onOpen={setDeviceModal}
                />
              ) : (
                <div className="space-y-3 text-sm text-zinc-500">
                  <p>Select a room or object to edit it.</p>
                  <p>Rooms resize from their four corners. Walls resize from either endpoint.</p>
                  <p>Delete/Backspace removes the selection; Escape clears it.</p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <DeviceModal
        open={!!deviceModal}
        device={deviceModal}
        onClose={() => setDeviceModal(null)}
        onChanged={(device) => {
          setDeviceModal(device);
          setDevices((items) => items.map((item) => (item.id === device.id ? device : item)));
        }}
      />
    </div>
  );
}

function pointFromChildEvent(event: ReactPointerEvent<SVGElement>, plan: FloorPlan) {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * plan.width) / rect.width,
    y: ((event.clientY - rect.top) * plan.height) / rect.height,
  };
}

function roomGuidesFromWalls(objects: FloorPlanObject[]) {
  const x: number[] = [];
  const y: number[] = [];
  for (const wall of objects.filter((item) => item.object_type === "wall")) {
    const angle = ((wall.rotation % 180) + 180) % 180;
    if (Math.abs(angle - 90) < 5) x.push(wall.x);
    if (angle < 5 || Math.abs(angle - 180) < 5) y.push(wall.y);
  }
  return { x, y };
}

function snapOpeningToRoom(object: FloorPlanObject, rooms: Room[], enabled: boolean) {
  if (!enabled) return { x: object.x, y: object.y, rotation: object.rotation };
  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;
  let best: { distance: number; x: number; y: number; rotation: number } | null = null;
  for (const room of rooms) {
    const candidates = [
      { distance: Math.abs(cy - room.y), x: object.x, y: room.y - object.height / 2, rotation: 0 },
      {
        distance: Math.abs(cy - (room.y + room.height)),
        x: object.x,
        y: room.y + room.height - object.height / 2,
        rotation: 0,
      },
      { distance: Math.abs(cx - room.x), x: room.x - object.width / 2, y: object.y, rotation: 90 },
      {
        distance: Math.abs(cx - (room.x + room.width)),
        x: room.x + room.width - object.width / 2,
        y: object.y,
        rotation: 90,
      },
    ];
    for (const candidate of candidates) {
      if (candidate.distance <= 18 && (!best || candidate.distance < best.distance)) best = candidate;
    }
  }
  return best || { x: object.x, y: object.y, rotation: object.rotation };
}

function RoomShape({
  room,
  selected,
  onMoveStart,
  onResizeStart,
  onSelect,
}: {
  room: Room;
  selected: boolean;
  onMoveStart: (event: ReactPointerEvent<SVGElement>) => void;
  onResizeStart: (event: ReactPointerEvent<SVGElement>, handle: ResizeHandle) => void;
  onSelect: () => void;
}) {
  const wallThickness = Number(room.properties?.wall_thickness || 12);
  const handles: { handle: ResizeHandle; x: number; y: number }[] = [
    { handle: "nw", x: room.x, y: room.y },
    { handle: "ne", x: room.x + room.width, y: room.y },
    { handle: "se", x: room.x + room.width, y: room.y + room.height },
    { handle: "sw", x: room.x, y: room.y + room.height },
  ];
  return (
    <g onPointerDown={onSelect}>
      <rect
        x={room.x}
        y={room.y}
        width={room.width}
        height={room.height}
        fill={selected ? "#164e6333" : "#18181b88"}
        stroke={selected ? "#22d3ee" : "#a1a1aa"}
        strokeWidth={wallThickness}
        onPointerDown={onMoveStart}
        style={{ cursor: "move" }}
      />
      <text
        x={room.x + room.width / 2}
        y={room.y + 24}
        textAnchor="middle"
        fill="#d4d4d8"
        fontSize="14"
        pointerEvents="none"
      >
        {room.name}
      </text>
      <text
        x={room.x + room.width / 2}
        y={room.y + 42}
        textAnchor="middle"
        fill="#71717a"
        fontSize="10"
        pointerEvents="none"
      >
        {Math.round(room.width)} × {Math.round(room.height)}
      </text>
      {selected &&
        handles.map((item) => (
          <rect
            key={item.handle}
            x={item.x - 7}
            y={item.y - 7}
            width="14"
            height="14"
            rx="2"
            fill="#22d3ee"
            stroke="#083344"
            strokeWidth="2"
            onPointerDown={(event) => onResizeStart(event, item.handle)}
            style={{ cursor: `${item.handle}-resize` }}
          />
        ))}
    </g>
  );
}

function ObjectShape({
  obj,
  device,
  selected,
  onMoveStart,
  onResizeStart,
  onWallEndStart,
  onSelect,
  onOpen,
}: {
  obj: FloorPlanObject;
  device?: Device;
  selected: boolean;
  onMoveStart: (event: ReactPointerEvent<SVGElement>) => void;
  onResizeStart: (event: ReactPointerEvent<SVGElement>, handle: ResizeHandle) => void;
  onWallEndStart: (event: ReactPointerEvent<SVGElement>, end: "start" | "end") => void;
  onSelect: () => void;
  onOpen: (device: Device) => void;
}) {
  const location = device?.state?.location;
  const moving =
    obj.object_type === "device" && location && Number.isFinite(location.x) && Number.isFinite(location.y);
  const x = moving ? Number(location.x) : obj.x;
  const y = moving ? Number(location.y) : obj.y;
  const tone = device ? statusTone(device) : "inactive";
  const deviceFill = tone === "active" ? "#065f46" : tone === "error" ? "#7f1d1d" : "#3f3f46";
  const stroke = selected ? "#22d3ee" : "#71717a";

  if (obj.object_type === "wall") {
    const end = wallEndPoint(obj);
    return (
      <g onPointerDown={onSelect}>
        <line
          x1={x}
          y1={y}
          x2={end.x}
          y2={end.y}
          stroke={selected ? "#d4d4d8" : "#a1a1aa"}
          strokeWidth={obj.height}
          strokeLinecap="square"
          onPointerDown={onMoveStart}
          style={{ cursor: "move" }}
        />
        {selected && (
          <>
            <circle
              cx={x}
              cy={y}
              r="9"
              fill="#22d3ee"
              stroke="#083344"
              strokeWidth="2"
              onPointerDown={(event) => onWallEndStart(event, "start")}
              style={{ cursor: "crosshair" }}
            />
            <circle
              cx={end.x}
              cy={end.y}
              r="9"
              fill="#22d3ee"
              stroke="#083344"
              strokeWidth="2"
              onPointerDown={(event) => onWallEndStart(event, "end")}
              style={{ cursor: "crosshair" }}
            />
          </>
        )}
      </g>
    );
  }

  const transform = `rotate(${obj.rotation} ${x + obj.width / 2} ${y + obj.height / 2})`;
  const handles: { handle: ResizeHandle; x: number; y: number }[] = [
    { handle: "nw", x, y },
    { handle: "ne", x: x + obj.width, y },
    { handle: "se", x: x + obj.width, y: y + obj.height },
    { handle: "sw", x, y: y + obj.height },
  ];

  const common = {
    onPointerDown: onMoveStart,
    onDoubleClick: () => device && onOpen(device),
    style: { cursor: "move" },
  };

  const body = renderObjectBody(obj, x, y, stroke, deviceFill, device);
  return (
    <g onPointerDown={onSelect} transform={transform}>
      <g {...common}>{body}</g>
      {selected &&
        obj.object_type !== "label" &&
        handles.map((item) => (
          <rect
            key={item.handle}
            x={item.x - 6}
            y={item.y - 6}
            width="12"
            height="12"
            rx="2"
            fill="#22d3ee"
            stroke="#083344"
            strokeWidth="2"
            onPointerDown={(event) => onResizeStart(event, item.handle)}
          />
        ))}
    </g>
  );
}

function renderObjectBody(
  obj: FloorPlanObject,
  x: number,
  y: number,
  stroke: string,
  deviceFill: string,
  device?: Device,
) {
  const w = obj.width;
  const h = obj.height;
  const furnitureFill = "#52525b";
  const wood = "#713f12";
  const fixture = "#3f3f46";

  if (obj.object_type === "door")
    return (
      <>
        <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#a16207" strokeWidth={Math.max(5, h)} />
        <path d={`M ${x} ${y + h / 2} A ${w} ${w} 0 0 1 ${x + w} ${y - w + h / 2}`} fill="none" stroke="#d97706" strokeWidth="2" />
      </>
    );
  if (obj.object_type === "window")
    return (
      <>
        <rect x={x} y={y} width={w} height={h} fill="#0e7490" stroke={stroke} />
        <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#67e8f9" strokeWidth="2" />
        <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#67e8f9" strokeWidth="2" />
      </>
    );
  if (obj.object_type === "stairs")
    return (
      <>
        <rect x={x} y={y} width={w} height={h} fill="#27272a" stroke={stroke} />
        {Array.from({ length: 8 }).map((_, index) => (
          <line key={index} x1={x} y1={y + ((index + 1) * h) / 9} x2={x + w} y2={y + ((index + 1) * h) / 9} stroke="#71717a" />
        ))}
        <path d={`M ${x + w / 2} ${y + h - 10} L ${x + w / 2} ${y + 15}`} stroke="#d4d4d8" strokeWidth="2" />
      </>
    );
  if (obj.object_type === "column")
    return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="#71717a" stroke={stroke} />;
  if (obj.object_type === "radiator")
    return (
      <>
        <rect x={x} y={y} width={w} height={h} rx="3" fill={fixture} stroke={stroke} />
        {Array.from({ length: 6 }).map((_, index) => (
          <line key={index} x1={x + ((index + 1) * w) / 7} y1={y + 3} x2={x + ((index + 1) * w) / 7} y2={y + h - 3} stroke="#a1a1aa" />
        ))}
      </>
    );
  if (obj.object_type === "fireplace")
    return (
      <>
        <rect x={x} y={y} width={w} height={h} fill="#44403c" stroke={stroke} />
        <path d={`M ${x + 15} ${y + h} V ${y + 10} H ${x + w - 15} V ${y + h}`} fill="none" stroke="#a8a29e" strokeWidth="5" />
      </>
    );
  if (obj.object_type === "sofa" || obj.object_type === "armchair")
    return (
      <>
        <rect x={x} y={y} rx="12" width={w} height={h} fill={furnitureFill} stroke={stroke} />
        <rect x={x + 8} y={y + 8} rx="8" width={w - 16} height={Math.max(15, h / 2)} fill="#71717a" />
        <rect x={x + 5} y={y + 8} rx="5" width="10" height={h - 16} fill="#3f3f46" />
        <rect x={x + w - 15} y={y + 8} rx="5" width="10" height={h - 16} fill="#3f3f46" />
      </>
    );
  if (obj.object_type === "bed")
    return (
      <>
        <rect x={x} y={y} rx="8" width={w} height={h} fill="#3f3f46" stroke={stroke} strokeWidth="2" />
        <rect x={x + 7} y={y + 8} rx="7" width={w - 14} height={h - 16} fill="#71717a" />
        <rect x={x + 12} y={y + 14} rx="8" width={w / 2 - 17} height={Math.min(42, h / 4)} fill="#d4d4d8" />
        <rect x={x + w / 2 + 5} y={y + 14} rx="8" width={w / 2 - 17} height={Math.min(42, h / 4)} fill="#d4d4d8" />
      </>
    );
  if (obj.object_type === "toilet")
    return (
      <>
        <rect x={x + w * 0.2} y={y} width={w * 0.6} height={h * 0.3} rx="4" fill="#e4e4e7" stroke={stroke} />
        <ellipse cx={x + w / 2} cy={y + h * 0.62} rx={w * 0.38} ry={h * 0.34} fill="#e4e4e7" stroke={stroke} />
        <ellipse cx={x + w / 2} cy={y + h * 0.62} rx={w * 0.2} ry={h * 0.18} fill="#0e7490" />
      </>
    );
  if (obj.object_type === "bath")
    return (
      <>
        <rect x={x} y={y} rx={h / 3} width={w} height={h} fill="#e4e4e7" stroke={stroke} />
        <rect x={x + 8} y={y + 8} rx={h / 3} width={w - 16} height={h - 16} fill="#164e63" />
      </>
    );
  if (obj.object_type === "shower")
    return (
      <>
        <rect x={x} y={y} width={w} height={h} fill="#164e6333" stroke={stroke} />
        <line x1={x} y1={y} x2={x + w} y2={y + h} stroke="#67e8f9" />
        <circle cx={x + w * 0.75} cy={y + h * 0.25} r="6" fill="#a1a1aa" />
      </>
    );
  if (obj.object_type === "sink")
    return (
      <>
        <rect x={x} y={y} rx="8" width={w} height={h} fill="#e4e4e7" stroke={stroke} />
        <ellipse cx={x + w / 2} cy={y + h / 2} rx={w * 0.32} ry={h * 0.28} fill="#164e63" />
        <circle cx={x + w / 2} cy={y + h / 2} r="3" fill="#a1a1aa" />
      </>
    );
  if (obj.object_type === "dining_chair" || obj.object_type === "office_chair")
    return (
      <>
        <rect x={x + 5} y={y + h * 0.25} rx="5" width={w - 10} height={h * 0.65} fill={furnitureFill} stroke={stroke} />
        <line x1={x + 7} y1={y + h * 0.25} x2={x + w - 7} y2={y + h * 0.25} stroke="#a1a1aa" strokeWidth="5" />
      </>
    );
  if (obj.object_type === "rug")
    return <rect x={x} y={y} rx="12" width={w} height={h} fill="#3f3f4655" stroke={selectedStroke(stroke)} strokeDasharray="8 5" />;
  if (obj.object_type === "plant")
    return (
      <>
        <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.38} fill="#14532d" stroke={stroke} />
        <path d={`M ${x + w / 2} ${y + h / 2} l -10 -12 M ${x + w / 2} ${y + h / 2} l 12 -10 M ${x + w / 2} ${y + h / 2} l 8 13`} stroke="#4ade80" strokeWidth="3" />
      </>
    );
  if (obj.object_type === "lamp")
    return (
      <>
        <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.35} fill="#facc15aa" stroke={stroke} />
        <circle cx={x + w / 2} cy={y + h / 2} r="4" fill="#fef08a" />
      </>
    );
  if (obj.object_type === "label")
    return <text x={x} y={y + 24} fill="#d4d4d8" stroke={stroke === "#22d3ee" ? stroke : "none"}>{obj.properties?.label || "Label"}</text>;
  if (obj.object_type === "device")
    return (
      <>
        <rect
          x={x}
          y={y}
          rx="18"
          width={w}
          height={h}
          fill={deviceFill}
          stroke={device && deviceIsActive(device) ? "#34d399" : stroke}
          strokeWidth="3"
        />
        <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fill="white" fontSize="12">
          {device?.name?.slice(0, 12) || "Device"}
        </text>
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fill="#d4d4d8" fontSize="9">
          {String(device?.state?.status || device?.status || "")}
        </text>
      </>
    );

  const label = humanise(obj.object_type);
  return (
    <>
      <rect x={x} y={y} rx="6" width={w} height={h} fill={isWoodObject(obj.object_type) ? wood : furnitureFill} stroke={stroke} />
      {obj.object_type === "kitchen_counter" && <line x1={x} y1={y + h * 0.2} x2={x + w} y2={y + h * 0.2} stroke="#a8a29e" />}
      {obj.object_type === "bookshelf" && Array.from({ length: 4 }).map((_, index) => <line key={index} x1={x + ((index + 1) * w) / 5} y1={y + 4} x2={x + ((index + 1) * w) / 5} y2={y + h - 4} stroke="#a16207" />)}
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="#d4d4d8" fontSize={Math.min(11, Math.max(7, w / 12))}>
        {label}
      </text>
    </>
  );
}

function selectedStroke(stroke: string) {
  return stroke === "#22d3ee" ? "#22d3ee" : "#71717a";
}

function isWoodObject(type: FloorPlanObjectType) {
  return new Set<FloorPlanObjectType>([
    "coffee_table",
    "dining_table",
    "desk",
    "wardrobe",
    "chest_drawers",
    "bedside_table",
    "bookshelf",
    "cabinet",
    "tv_stand",
    "kitchen_counter",
    "kitchen_island",
  ]).has(type);
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RoomInspector({
  room,
  onChange,
  onSave,
}: {
  room: Room;
  onChange: (changes: Partial<Room>) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Room</h2>
        <p className="mt-1 text-xs text-zinc-500">Drag the room or resize it from any selected corner.</p>
      </div>
      <label className="block text-xs text-zinc-500">
        Name
        <input
          value={room.name}
          onChange={(event) => onChange({ name: event.target.value })}
          onBlur={onSave}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key} className="block text-xs capitalize text-zinc-500">
            {key}
            <input
              type="number"
              value={Math.round(room[key])}
              onChange={(event) => onChange({ [key]: Number(event.target.value) })}
              onBlur={onSave}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
            />
          </label>
        ))}
      </div>
      <label className="block text-xs text-zinc-500">
        Wall thickness
        <input
          type="number"
          min="4"
          max="30"
          value={Number(room.properties?.wall_thickness || 12)}
          onChange={(event) =>
            onChange({ properties: { ...room.properties, wall_thickness: Number(event.target.value) } })
          }
          onBlur={onSave}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
        />
      </label>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
        {Math.round(room.width)} × {Math.round(room.height)} canvas units
      </div>
    </div>
  );
}

function ObjectInspector({
  obj,
  device,
  onChange,
  onSave,
  onOpen,
}: {
  obj: FloorPlanObject;
  device?: Device;
  onChange: (changes: Partial<FloorPlanObject>) => void;
  onSave: () => void;
  onOpen: (device: Device) => void;
}) {
  const wall = obj.object_type === "wall";
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">{device?.name || humanise(obj.object_type)}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {wall ? "Drag either endpoint to change wall length and angle." : "Drag the object; selected corners resize it."}
        </p>
      </div>
      {obj.object_type === "label" && (
        <label className="block text-xs text-zinc-500">
          Text
          <input
            value={String(obj.properties?.label || "")}
            onChange={(event) => onChange({ properties: { ...obj.properties, label: event.target.value } })}
            onBlur={onSave}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height", "rotation"] as const).map((key) => (
          <label key={key} className="block text-xs capitalize text-zinc-500">
            {wall && key === "width" ? "length" : wall && key === "height" ? "thickness" : key}
            <input
              type="number"
              value={Math.round(obj[key] * 10) / 10}
              onChange={(event) => onChange({ [key]: Number(event.target.value) })}
              onBlur={onSave}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
            />
          </label>
        ))}
      </div>
      {device && (
        <button
          onClick={() => onOpen(device)}
          className="w-full rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white"
        >
          Open device controls
        </button>
      )}
    </div>
  );
}
