import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as mdi from "@mdi/js";
import Icon from "@mdi/react";

import { apiUrl, get, patch, post, remove } from "../../shared/api/client";
import type {
  DashboardCard,
  DashboardGroup,
  Device,
} from "../../shared/types";
import {
  deviceIsActive,
  statusTone,
  visibleControls,
} from "../../shared/deviceState";
import ControlPanel from "../../shared/components/ControlPanel";
import DeviceModal from "../../shared/components/DeviceModal";
import Modal from "../../shared/components/Modal";
import {
  DASHBOARD_COLUMNS,
  dashboardGridHeight,
  findFreeDashboardPosition,
  resolveDashboardMove,
  resolveDashboardResize,
  type DashboardRect,
} from "./dashboardLayout";

const ROW_HEIGHT = 64;
const ROW_GAP = 12;
const paths = mdi as unknown as Record<string, string>;

type ResizeHandle = "nw" | "ne" | "se" | "sw";

type LayoutInteraction = {
  kind: "move" | "resize";
  groupId: number | null;
  cardId: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  initialCards: DashboardRect[];
  origin: DashboardRect;
  handle?: ResizeHandle;
};

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<DashboardGroup[]>([]);
  const [selected, setSelected] = useState<Device | null>(null);
  const [customise, setCustomise] = useState<Device | null>(null);
  const [editLayout, setEditLayout] = useState(false);
  const [groupEditor, setGroupEditor] = useState<DashboardGroup | "new" | null>(
    null,
  );
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hydratingIds, setHydratingIds] = useState<Set<number>>(new Set());
  const interaction = useRef<LayoutInteraction | null>(null);
  const refreshInFlight = useRef(false);
  const hasLoadedSnapshot = useRef(false);
  const sectionRefs = useRef(
    new Map<string, HTMLDivElement>(),
  );

  useEffect(() => {
    let cancelled = false;

    const loadGroups = async () => {
      try {
        const data = await get<DashboardGroup[]>("/dashboard-groups/");
        if (!cancelled) setGroups(data);
      } catch {
        // The dashboard remains usable without custom groups.
      }
    };

    const refresh = async () => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      const firstSnapshot = !hasLoadedSnapshot.current;

      try {
        const current = await get<Device[]>("/devices/");
        if (cancelled) return;

        // Render the persisted dashboard immediately. Live device I/O happens
        // afterwards so one slow integration can never hold the whole page blank.
        setDevices(current);
        setInitialLoading(false);
        if (firstSnapshot) {
          hasLoadedSnapshot.current = true;
          setHydratingIds(new Set(current.map((device) => device.id)));
        }

        await Promise.allSettled(
          current.map(async (device) => {
            try {
              const next = (
                await post<{ device: Device }>(
                  `/devices/${device.id}/refresh/`,
                )
              ).device;
              if (!cancelled) {
                setDevices((items) =>
                  items.map((item) => (item.id === next.id ? next : item)),
                );
              }
            } catch {
              // The backend preserves the last-known-good state through short failures.
            } finally {
              if (firstSnapshot && !cancelled) {
                setHydratingIds((ids) => {
                  const next = new Set(ids);
                  next.delete(device.id);
                  return next;
                });
              }
            }
          }),
        );
      } catch {
        if (firstSnapshot && !cancelled) setInitialLoading(false);
      } finally {
        refreshInFlight.current = false;
      }
    };

    void loadGroups();
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const shown = useMemo(
    () =>
      devices.filter(
        (device) => device.dashboard_card?.enabled !== false,
      ),
    [devices],
  );

  const sections = useMemo(
    () => [
      {
        id: null as number | null,
        name: "Home",
        order: -1,
      },
      ...groups
        .slice()
        .sort((left, right) => left.order - right.order || left.id - right.id),
    ],
    [groups],
  );

  const updateDevice = (next: Device) =>
    setDevices((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );

  const control = async (
    device: Device,
    action: string,
    parameters?: Record<string, unknown>,
  ) => {
    const result = await post<{ state: Record<string, unknown> }>(
      `/devices/${device.id}/control/`,
      { action, parameters },
    );
    updateDevice({
      ...device,
      state: result.state,
      status: String(result.state.status || device.status),
    });
  };

  const cardsForGroup = (groupId: number | null) =>
    shown
      .filter(
        (device) =>
          (device.dashboard_card?.group ?? null) === groupId &&
          Boolean(device.dashboard_card),
      )
      .map((device) => device.dashboard_card!)
      .sort(
        (left, right) =>
          left.grid_y - right.grid_y ||
          left.grid_x - right.grid_x ||
          left.id - right.id,
      );

  const applyLayout = (
    groupId: number | null,
    nextCards: DashboardRect[],
  ) => {
    const byId = new Map(nextCards.map((card) => [card.id, card]));
    setDevices((items) =>
      items.map((device) => {
        const card = device.dashboard_card;
        if (!card || (card.group ?? null) !== groupId) return device;
        const next = byId.get(card.id);
        if (!next) return device;
        return {
          ...device,
          dashboard_card: {
            ...card,
            grid_x: next.grid_x,
            grid_y: next.grid_y,
            grid_w: next.grid_w,
            grid_h: next.grid_h,
          },
        };
      }),
    );
  };

  const persistChangedCards = async (
    initial: DashboardRect[],
    current: DashboardRect[],
  ) => {
    const before = new Map(initial.map((card) => [card.id, card]));
    const changed = current.filter((card) => {
      const original = before.get(card.id);
      return (
        !original ||
        original.grid_x !== card.grid_x ||
        original.grid_y !== card.grid_y ||
        original.grid_w !== card.grid_w ||
        original.grid_h !== card.grid_h
      );
    });

    if (!changed.length) return;

    setLayoutSaving(true);
    try {
      const response = await post<{ cards: DashboardCard[] }>(
        "/dashboard-cards/layout/",
        {
          cards: changed.map((card) => ({
            id: card.id,
            grid_x: card.grid_x,
            grid_y: card.grid_y,
            grid_w: card.grid_w,
            grid_h: card.grid_h,
          })),
        },
      );
      const savedById = new Map(
        response.cards.map((card) => [card.id, card]),
      );
      setDevices((items) =>
        items.map((device) => {
          const card = device.dashboard_card;
          const next = card ? savedById.get(card.id) : undefined;
          return next ? { ...device, dashboard_card: next } : device;
        }),
      );
    } finally {
      setLayoutSaving(false);
    }
  };

  const beginInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    device: Device,
    kind: "move" | "resize",
    handle?: ResizeHandle,
  ) => {
    if (!editLayout || !device.dashboard_card) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const groupId = device.dashboard_card.group ?? null;
    const initialCards = cardsForGroup(groupId).map((card) => ({
      id: card.id,
      grid_x: card.grid_x,
      grid_y: card.grid_y,
      grid_w: card.grid_w,
      grid_h: card.grid_h,
    }));
    const origin = initialCards.find(
      (card) => card.id === device.dashboard_card?.id,
    );
    if (!origin) return;

    interaction.current = {
      kind,
      groupId,
      cardId: origin.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialCards,
      origin,
      handle,
    };
  };

  const moveInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const key = current.groupId == null ? "ungrouped" : String(current.groupId);
    const section = sectionRefs.current.get(key);
    if (!section) return;

    const rect = section.getBoundingClientRect();
    const columnPitch = rect.width / DASHBOARD_COLUMNS;
    const dx = Math.round(
      (event.clientX - current.startClientX) / columnPitch,
    );
    const dy = Math.round(
      (event.clientY - current.startClientY) / (ROW_HEIGHT + ROW_GAP),
    );

    let next: DashboardRect[];

    if (current.kind === "move") {
      next = resolveDashboardMove(
        current.initialCards,
        current.cardId,
        current.origin.grid_x + dx,
        current.origin.grid_y + dy,
      );
    } else {
      const handle = current.handle || "se";
      let grid_x = current.origin.grid_x;
      let grid_y = current.origin.grid_y;
      let grid_w = current.origin.grid_w;
      let grid_h = current.origin.grid_h;

      if (handle.includes("e")) grid_w = current.origin.grid_w + dx;
      if (handle.includes("s")) grid_h = current.origin.grid_h + dy;
      if (handle.includes("w")) {
        grid_x = current.origin.grid_x + dx;
        grid_w = current.origin.grid_w - dx;
      }
      if (handle.includes("n")) {
        grid_y = current.origin.grid_y + dy;
        grid_h = current.origin.grid_h - dy;
      }

      next = resolveDashboardResize(
        current.initialCards,
        current.cardId,
        {
          grid_x,
          grid_y,
          grid_w,
          grid_h,
        },
      );
    }

    applyLayout(current.groupId, next);
  };

  const endInteraction = async (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;

    interaction.current = null;
    const now = cardsForGroup(current.groupId).map((card) => ({
      id: card.id,
      grid_x: card.grid_x,
      grid_y: card.grid_y,
      grid_w: card.grid_w,
      grid_h: card.grid_h,
    }));

    await persistChangedCards(current.initialCards, now);
  };

  const moveGroup = async (
    group: DashboardGroup,
    direction: -1 | 1,
  ) => {
    const ordered = groups
      .slice()
      .sort((left, right) => left.order - right.order || left.id - right.id);
    const index = ordered.findIndex((item) => item.id === group.id);
    const other = ordered[index + direction];
    if (!other) return;

    const [savedGroup, savedOther] = await Promise.all([
      patch<DashboardGroup>(`/dashboard-groups/${group.id}/`, {
        order: other.order,
      }),
      patch<DashboardGroup>(`/dashboard-groups/${other.id}/`, {
        order: group.order,
      }),
    ]);

    setGroups((items) =>
      items.map((item) => {
        if (item.id === savedGroup.id) return savedGroup;
        if (item.id === savedOther.id) return savedOther;
        return item;
      }),
    );
  };

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Home</h1>
          <p className="mt-2 max-w-3xl text-zinc-400">
            Your house at a glance. Arrange, resize and group device bubbles
            while HomeHub keeps everything aligned to a collision-safe grid.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editLayout && (
            <button
              type="button"
              onClick={() => setGroupEditor("new")}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-cyan-600 hover:text-white"
            >
              <Icon path={paths.mdiFolderPlusOutline} size={0.7} />
              New group
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditLayout((value) => !value)}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              editLayout
                ? "bg-cyan-600 text-white"
                : "border border-zinc-700 text-zinc-300 hover:border-cyan-600 hover:text-white"
            }`}
          >
            <Icon
              path={
                editLayout
                  ? paths.mdiCheck
                  : paths.mdiViewDashboardEditOutline
              }
              size={0.7}
            />
            {editLayout ? "Done editing" : "Edit layout"}
          </button>
        </div>
      </header>

      {editLayout && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-900/50 bg-cyan-950/15 px-4 py-3 text-sm text-zinc-300">
          <div>
            Drag a bubble to move it. Drag any corner to resize. Cards snap to
            the grid, refuse overlaps and swap positions when possible.
          </div>
          <div className="text-xs text-zinc-500">
            {layoutSaving ? "Saving layout…" : "Layout changes save automatically"}
          </div>
        </div>
      )}

      {initialLoading ? (
        <DashboardSkeleton />
      ) : !shown.length ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-16 text-center text-zinc-500">
          Add a device from the Devices page and it will appear here automatically.
        </div>
      ) : (
        <div className="space-y-7">
          {sections.map((section) => {
            const sectionDevices = shown.filter(
              (device) =>
                (device.dashboard_card?.group ?? null) === section.id,
            );
            if (!sectionDevices.length && section.id == null && groups.length) {
              return null;
            }
            if (!sectionDevices.length && !editLayout) return null;

            const cards = sectionDevices
              .map((device) => device.dashboard_card)
              .filter(Boolean) as DashboardCard[];
            const rows = dashboardGridHeight(
              cards.map((card) => ({
                id: card.id,
                grid_x: card.grid_x,
                grid_y: card.grid_y,
                grid_w: card.grid_w,
                grid_h: card.grid_h,
              })),
            );
            const key =
              section.id == null ? "ungrouped" : String(section.id);

            return (
              <section
                key={key}
                className="rounded-3xl border border-zinc-800/80 bg-zinc-950/30 p-4"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {section.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {sectionDevices.length} device
                      {sectionDevices.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {editLayout && section.id != null && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void moveGroup(section as DashboardGroup, -1)
                        }
                        className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-white"
                        title="Move group up"
                      >
                        <Icon path={paths.mdiChevronUp} size={0.6} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void moveGroup(section as DashboardGroup, 1)
                        }
                        className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-white"
                        title="Move group down"
                      >
                        <Icon path={paths.mdiChevronDown} size={0.6} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setGroupEditor(section as DashboardGroup)
                        }
                        className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
                      >
                        Manage group
                      </button>
                    </div>
                  )}
                </div>

                <div
                  ref={(element) => {
                    if (element) sectionRefs.current.set(key, element);
                    else sectionRefs.current.delete(key);
                  }}
                  className={`grid grid-cols-12 gap-3 ${
                    editLayout
                      ? "rounded-2xl bg-[linear-gradient(to_right,rgba(63,63,70,.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(63,63,70,.18)_1px,transparent_1px)] bg-[size:calc(100%/12)_76px]"
                      : ""
                  }`}
                  style={{
                    gridAutoRows: `${ROW_HEIGHT}px`,
                    minHeight: `${rows * ROW_HEIGHT + Math.max(0, rows - 1) * ROW_GAP}px`,
                  }}
                >
                  {sectionDevices.map((device) => {
                    const card = device.dashboard_card;
                    if (!card) return null;
                    const tone = statusTone(device);
                    const active = deviceIsActive(device);
                    const hydrating = hydratingIds.has(device.id);

                    return (
                      <article
                        key={device.id}
                        onPointerDown={(event) =>
                          beginInteraction(event, device, "move")
                        }
                        onPointerMove={moveInteraction}
                        onPointerUp={(event) => void endInteraction(event)}
                        onPointerCancel={(event) => void endInteraction(event)}
                        className={`relative min-h-0 overflow-hidden rounded-3xl border shadow-xl transition ${
                          hydrating ? "animate-pulse" : ""
                        } ${
                          editLayout
                            ? "cursor-grab select-none ring-1 ring-cyan-900/20 active:cursor-grabbing"
                            : ""
                        } ${
                          tone === "active"
                            ? "border-emerald-500/40 bg-emerald-950/20"
                            : tone === "error"
                              ? "border-red-900 bg-red-950/20"
                              : "border-zinc-800 bg-zinc-900/80"
                        }`}
                        style={{
                          gridColumn: `${card.grid_x + 1} / span ${card.grid_w}`,
                          gridRow: `${card.grid_y + 1} / span ${card.grid_h}`,
                        }}
                      >
                        <div
                          className={`h-full overflow-y-auto p-5 ${
                            editLayout ? "pointer-events-none opacity-80" : ""
                          }`}
                        >
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <button
                              className="text-left"
                              onClick={() => setSelected(device)}
                            >
                              <div className="text-lg font-semibold text-white">
                                {device.name}
                              </div>
                              <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
                                {device.device_type} ·{" "}
                                {String(device.state?.status || device.status)}
                              </div>
                            </button>
                            <div
                              className={`h-3 w-3 shrink-0 rounded-full ${
                                active
                                  ? "bg-emerald-400 shadow-[0_0_14px_#34d399]"
                                  : "bg-zinc-600"
                              }`}
                            />
                          </div>

                          {(device.device_type === "camera" ||
                            device.state?.camera_available) &&
                            card.grid_h >= 4 && (
                              <DashboardCameraPreview
                                device={device}
                                onOpen={() => setSelected(device)}
                              />
                            )}

                          <ControlPanel
                            compact
                            device={device}
                            controls={visibleControls(device)}
                            onControl={(action, params) =>
                              control(device, action, params)
                            }
                          />

                          <div className="mt-4 flex flex-wrap gap-2 text-xs">
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
                        </div>

                        {editLayout && (
                          <>
                            <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-1 text-[10px] uppercase tracking-[.15em] text-zinc-400">
                              Drag to move
                            </div>
                            {(["nw", "ne", "se", "sw"] as ResizeHandle[]).map(
                              (handle) => (
                                <button
                                  key={handle}
                                  type="button"
                                  aria-label={`Resize ${device.name} from ${handle}`}
                                  onPointerDown={(event) =>
                                    beginInteraction(
                                      event,
                                      device,
                                      "resize",
                                      handle,
                                    )
                                  }
                                  onPointerMove={moveInteraction}
                                  onPointerUp={(event) =>
                                    void endInteraction(event)
                                  }
                                  onPointerCancel={(event) =>
                                    void endInteraction(event)
                                  }
                                  className={`absolute z-20 h-4 w-4 rounded-sm border-2 border-zinc-950 bg-cyan-400 shadow ${
                                    handle === "nw"
                                      ? "-left-1 -top-1 cursor-nwse-resize"
                                      : handle === "ne"
                                        ? "-right-1 -top-1 cursor-nesw-resize"
                                        : handle === "se"
                                          ? "-bottom-1 -right-1 cursor-nwse-resize"
                                          : "-bottom-1 -left-1 cursor-nesw-resize"
                                  }`}
                                />
                              ),
                            )}
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>

                {!sectionDevices.length && editLayout && (
                  <div className="py-6 text-center text-xs text-zinc-600">
                    No devices in this group yet. Use a device's Customise menu
                    to move it here.
                  </div>
                )}
              </section>
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
        groups={groups}
        devices={devices}
        onClose={() => setCustomise(null)}
        onSaved={(device) => {
          updateDevice(device);
          setCustomise(null);
        }}
      />

      <GroupEditor
        open={groupEditor != null}
        group={groupEditor}
        groups={groups}
        devices={devices}
        onClose={() => setGroupEditor(null)}
        onSaved={(group) => {
          setGroups((items) => {
            const exists = items.some((item) => item.id === group.id);
            return exists
              ? items.map((item) => (item.id === group.id ? group : item))
              : [...items, group];
          });
          setGroupEditor(null);
        }}
        onDeleted={(groupId, movedCards) => {
          setGroups((items) => items.filter((item) => item.id !== groupId));
          const byId = new Map(movedCards.map((card) => [card.id, card]));
          setDevices((items) =>
            items.map((device) => {
              const card = device.dashboard_card;
              const next = card ? byId.get(card.id) : undefined;
              return next ? { ...device, dashboard_card: next } : device;
            }),
          );
          setGroupEditor(null);
        }}
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <section className="rounded-3xl border border-zinc-800/80 bg-zinc-950/30 p-4">
      <div className="mb-4">
        <div className="h-5 w-20 animate-pulse rounded bg-zinc-800" />
        <div className="mt-2 h-3 w-16 animate-pulse rounded bg-zinc-900" />
      </div>
      <div className="grid grid-cols-12 gap-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="col-span-12 h-48 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/70 md:col-span-6 xl:col-span-4"
          >
            <div className="p-5">
              <div className="h-5 w-32 rounded bg-zinc-800" />
              <div className="mt-3 h-3 w-20 rounded bg-zinc-800/70" />
              <div className="mt-8 h-9 w-40 rounded-xl bg-zinc-800/60" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardCameraPreview({
  device,
  onOpen,
}: {
  device: Device;
  onOpen: () => void;
}) {
  const [src, setSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    const refresh = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${apiUrl(
            `/devices/${device.id}/camera-frame/`,
          )}?dashboard=${Date.now()}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          let message = `Camera preview failed (${response.status})`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) message = payload.error;
          } catch {
            // Keep the HTTP fallback when the upstream body is not JSON.
          }
          throw new Error(message);
        }

        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("image/")) {
          throw new Error("Camera returned an invalid preview image.");
        }

        const nextUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }

        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = nextUrl;
        setSrc(nextUrl);
        setError("");
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Camera preview is temporarily unavailable.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [device.id]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-4 block w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black text-left transition hover:border-cyan-700"
      title={`Open ${device.name} camera controls`}
    >
      <div className="relative aspect-video w-full">
        {src ? (
          <img
            src={src}
            alt={`${device.name} camera preview`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-500">
            {loading ? "Loading camera preview…" : "Camera preview unavailable"}
          </div>
        )}
        {loading && src && (
          <div className="absolute inset-x-0 bottom-0 bg-black/65 px-3 py-1.5 text-center text-[10px] text-zinc-300">
            Refreshing preview…
          </div>
        )}
      </div>
      {error && (
        <div className="border-t border-zinc-800 px-3 py-2 text-[10px] leading-4 text-amber-400">
          {error}
        </div>
      )}
    </button>
  );
}

function CardSettings({
  open,
  device,
  groups,
  devices,
  onClose,
  onSaved,
}: {
  open: boolean;
  device: Device | null;
  groups: DashboardGroup[];
  devices: Device[];
  onClose: () => void;
  onSaved: (device: Device) => void;
}) {
  const [visible, setVisible] = useState<string[]>([]);
  const [group, setGroup] = useState<string>("");

  useEffect(() => {
    if (device) {
      setVisible(device.dashboard_card?.visible_controls || []);
      setGroup(
        device.dashboard_card?.group == null
          ? ""
          : String(device.dashboard_card.group),
      );
    }
  }, [device]);

  if (!device) return null;

  const all = device.capabilities?.controls || [];

  const save = async () => {
    if (!device.dashboard_card) return;

    const currentCard = device.dashboard_card;
    const groupId = group ? Number(group) : null;

    let saved = await patch<DashboardCard>(
      `/dashboard-cards/${currentCard.id}/`,
      { visible_controls: visible },
    );

    if (groupId !== (currentCard.group ?? null)) {
      const occupied = devices
        .filter(
          (item) =>
            item.dashboard_card &&
            item.dashboard_card.id !== currentCard.id &&
            (item.dashboard_card.group ?? null) === groupId,
        )
        .map((item) => {
          const card = item.dashboard_card!;
          return {
            id: card.id,
            grid_x: card.grid_x,
            grid_y: card.grid_y,
            grid_w: card.grid_w,
            grid_h: card.grid_h,
          };
        });

      const slot = findFreeDashboardPosition(
        {
          id: currentCard.id,
          grid_x: currentCard.grid_x,
          grid_y: currentCard.grid_y,
          grid_w: currentCard.grid_w,
          grid_h: currentCard.grid_h,
        },
        occupied,
      );

      const layout = await post<{ cards: DashboardCard[] }>(
        "/dashboard-cards/layout/",
        {
          cards: [
            {
              id: currentCard.id,
              group: groupId,
              grid_x: slot.grid_x,
              grid_y: slot.grid_y,
              grid_w: slot.grid_w,
              grid_h: slot.grid_h,
            },
          ],
        },
      );
      saved = layout.cards[0] || saved;
    }

    onSaved({ ...device, dashboard_card: saved });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Customise ${device.name}`}>
      <div className="space-y-5">
        <label className="block text-sm text-zinc-400">
          Dashboard group
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
          >
            <option value="">Home / ungrouped</option>
            {groups
              .slice()
              .sort(
                (left, right) =>
                  left.order - right.order || left.id - right.id,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-xs leading-5 text-zinc-600">
            Use Edit layout on the Home page to resize and position the bubble.
          </span>
        </label>

        <div>
          <div className="mb-2 text-sm text-zinc-400">
            Controls shown on the card
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {all.map((control) => (
              <label
                key={control.action}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={visible.includes(control.action)}
                  onChange={(event) =>
                    setVisible(
                      event.target.checked
                        ? [...visible, control.action]
                        : visible.filter(
                            (value) => value !== control.action,
                          ),
                    )
                  }
                />
                {control.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => void save()}
            className="rounded-lg bg-cyan-600 px-4 py-2 font-semibold text-white"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function GroupEditor({
  open,
  group,
  groups,
  devices,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  group: DashboardGroup | "new" | null;
  groups: DashboardGroup[];
  devices: Device[];
  onClose: () => void;
  onSaved: (group: DashboardGroup) => void;
  onDeleted: (groupId: number, movedCards: DashboardCard[]) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (group === "new") setName("");
    else if (group) setName(group.name);
  }, [group]);

  if (!group) return null;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (group === "new") {
      const created = await post<DashboardGroup>("/dashboard-groups/", {
        name: trimmed,
        order:
          groups.length > 0
            ? Math.max(...groups.map((item) => item.order)) + 1
            : 0,
      });
      onSaved(created);
      return;
    }

    onSaved(
      await patch<DashboardGroup>(
        `/dashboard-groups/${group.id}/`,
        { name: trimmed },
      ),
    );
  };

  const deleteGroup = async () => {
    if (group === "new") return;

    const occupied: DashboardRect[] = devices
      .filter(
        (device) =>
          device.dashboard_card &&
          (device.dashboard_card.group ?? null) === null,
      )
      .map((device) => {
        const card = device.dashboard_card!;
        return {
          id: card.id,
          grid_x: card.grid_x,
          grid_y: card.grid_y,
          grid_w: card.grid_w,
          grid_h: card.grid_h,
        };
      });

    const updates: Array<DashboardRect & { group: null }> = [];
    const moving = devices
      .filter((device) => device.dashboard_card?.group === group.id)
      .map((device) => device.dashboard_card!)
      .sort(
        (left, right) =>
          left.grid_y - right.grid_y ||
          left.grid_x - right.grid_x ||
          left.id - right.id,
      );

    for (const card of moving) {
      const slot = findFreeDashboardPosition(
        {
          id: card.id,
          grid_x: card.grid_x,
          grid_y: card.grid_y,
          grid_w: card.grid_w,
          grid_h: card.grid_h,
        },
        occupied,
      );
      occupied.push(slot);
      updates.push({ ...slot, group: null });
    }

    let movedCards: DashboardCard[] = [];
    if (updates.length) {
      const response = await post<{ cards: DashboardCard[] }>(
        "/dashboard-cards/layout/",
        { cards: updates },
      );
      movedCards = response.cards;
    }

    await remove<void>(`/dashboard-groups/${group.id}/`);
    onDeleted(group.id, movedCards);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group === "new" ? "Create device group" : `Manage ${group.name}`}
    >
      <div className="space-y-5">
        <label className="block text-sm text-zinc-400">
          Group name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Living room, Media, Climate"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-white"
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          {group !== "new" ? (
            <button
              type="button"
              onClick={() => void deleteGroup()}
              className="rounded-lg border border-red-900/70 px-3 py-2 text-sm text-red-400 hover:bg-red-950/30"
            >
              Delete group
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => void save()}
            className="rounded-lg bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
          >
            {group === "new" ? "Create group" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
