export type Point = { x: number; y: number };
export type RectLike = { id?: number; x: number; y: number; width: number; height: number };
export type SnapGuide = { axis: "x" | "y"; value: number };
export type SnapResult<T> = { value: T; guides: SnapGuide[] };

export const GRID_SIZE = 10;
export const SNAP_THRESHOLD = 12;
export const MIN_ROOM_SIZE = 80;
export const MIN_OBJECT_SIZE = 20;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function rectEdges(rect: RectLike) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
  };
}

function closest(value: number, targets: number[]) {
  let result: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const nextDistance = Math.abs(target - value);
    if (nextDistance <= SNAP_THRESHOLD && nextDistance < distance) {
      distance = nextDistance;
      result = target;
    }
  }
  return result;
}

export function snapValue(value: number, targets: number[], enabled = true) {
  if (!enabled) return value;
  const target = closest(value, targets);
  if (target !== null) return target;
  const grid = Math.round(value / GRID_SIZE) * GRID_SIZE;
  return Math.abs(grid - value) <= SNAP_THRESHOLD ? grid : value;
}

export function roomSnapTargets(rooms: RectLike[], excludeId?: number, bounds?: { width: number; height: number }) {
  const x: number[] = bounds ? [0, bounds.width] : [];
  const y: number[] = bounds ? [0, bounds.height] : [];
  for (const room of rooms) {
    if (excludeId && room.id === excludeId) continue;
    const edges = rectEdges(room);
    x.push(edges.left, edges.right, edges.cx);
    y.push(edges.top, edges.bottom, edges.cy);
  }
  return { x, y };
}

export function snapRoomPosition(
  rect: RectLike,
  rooms: RectLike[],
  bounds: { width: number; height: number },
  enabled = true,
  extraTargets: { x: number[]; y: number[] } = { x: [], y: [] },
): SnapResult<{ x: number; y: number }> {
  if (!enabled) {
    return {
      value: {
        x: clamp(rect.x, 0, Math.max(0, bounds.width - rect.width)),
        y: clamp(rect.y, 0, Math.max(0, bounds.height - rect.height)),
      },
      guides: [],
    };
  }
  const base = roomSnapTargets(rooms, rect.id, bounds);
  const xTargets = [...base.x, ...extraTargets.x];
  const yTargets = [...base.y, ...extraTargets.y];
  const edges = rectEdges(rect);
  const xCandidates = [
    { value: edges.left, offset: 0 },
    { value: edges.right, offset: rect.width },
    { value: edges.cx, offset: rect.width / 2 },
  ];
  const yCandidates = [
    { value: edges.top, offset: 0 },
    { value: edges.bottom, offset: rect.height },
    { value: edges.cy, offset: rect.height / 2 },
  ];
  let x = Math.round(rect.x / GRID_SIZE) * GRID_SIZE;
  let y = Math.round(rect.y / GRID_SIZE) * GRID_SIZE;
  const guides: SnapGuide[] = [];

  for (const candidate of xCandidates) {
    const target = closest(candidate.value, xTargets);
    if (target !== null) {
      x = target - candidate.offset;
      guides.push({ axis: "x", value: target });
      break;
    }
  }
  for (const candidate of yCandidates) {
    const target = closest(candidate.value, yTargets);
    if (target !== null) {
      y = target - candidate.offset;
      guides.push({ axis: "y", value: target });
      break;
    }
  }

  return {
    value: {
      x: clamp(x, 0, Math.max(0, bounds.width - rect.width)),
      y: clamp(y, 0, Math.max(0, bounds.height - rect.height)),
    },
    guides,
  };
}

export function resizeRect(
  rect: RectLike,
  handle: "nw" | "ne" | "se" | "sw",
  point: Point,
  rooms: RectLike[],
  bounds: { width: number; height: number },
  enabled = true,
  minSize = MIN_ROOM_SIZE,
  extraTargets: { x: number[]; y: number[] } = { x: [], y: [] },
): SnapResult<{ x: number; y: number; width: number; height: number }> {
  const opposite = {
    nw: { x: rect.x + rect.width, y: rect.y + rect.height },
    ne: { x: rect.x, y: rect.y + rect.height },
    se: { x: rect.x, y: rect.y },
    sw: { x: rect.x + rect.width, y: rect.y },
  }[handle];
  const base = roomSnapTargets(rooms, rect.id, bounds);
  const xTargets = [...base.x, ...extraTargets.x];
  const yTargets = [...base.y, ...extraTargets.y];
  let x = clamp(point.x, 0, bounds.width);
  let y = clamp(point.y, 0, bounds.height);
  const guides: SnapGuide[] = [];

  if (enabled) {
    const sx = closest(x, xTargets);
    const sy = closest(y, yTargets);
    if (sx !== null) {
      x = sx;
      guides.push({ axis: "x", value: sx });
    } else {
      x = Math.round(x / GRID_SIZE) * GRID_SIZE;
    }
    if (sy !== null) {
      y = sy;
      guides.push({ axis: "y", value: sy });
    } else {
      y = Math.round(y / GRID_SIZE) * GRID_SIZE;
    }
  }

  let left = Math.min(opposite.x, x);
  let right = Math.max(opposite.x, x);
  let top = Math.min(opposite.y, y);
  let bottom = Math.max(opposite.y, y);

  if (right - left < minSize) {
    if (handle === "nw" || handle === "sw") left = right - minSize;
    else right = left + minSize;
  }
  if (bottom - top < minSize) {
    if (handle === "nw" || handle === "ne") top = bottom - minSize;
    else bottom = top + minSize;
  }

  left = clamp(left, 0, bounds.width - minSize);
  top = clamp(top, 0, bounds.height - minSize);
  right = clamp(right, left + minSize, bounds.width);
  bottom = clamp(bottom, top + minSize, bounds.height);
  return { value: { x: left, y: top, width: right - left, height: bottom - top }, guides };
}

export function wallEndPoint(wall: RectLike & { rotation: number }): Point {
  const radians = (wall.rotation * Math.PI) / 180;
  return { x: wall.x + Math.cos(radians) * wall.width, y: wall.y + Math.sin(radians) * wall.width };
}

export function wallFromEndpoints(start: Point, end: Point, thickness: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    x: start.x,
    y: start.y,
    width: Math.max(MIN_OBJECT_SIZE, Math.hypot(dx, dy)),
    height: thickness,
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

export function collectSnapPoints(rooms: RectLike[], walls: (RectLike & { rotation: number })[], excludeWall?: number) {
  const points: Point[] = [];
  for (const room of rooms) {
    const e = rectEdges(room);
    points.push(
      { x: e.left, y: e.top },
      { x: e.right, y: e.top },
      { x: e.right, y: e.bottom },
      { x: e.left, y: e.bottom },
      { x: e.cx, y: e.top },
      { x: e.cx, y: e.bottom },
      { x: e.left, y: e.cy },
      { x: e.right, y: e.cy },
    );
  }
  for (const wall of walls) {
    if (excludeWall && wall.id === excludeWall) continue;
    points.push({ x: wall.x, y: wall.y }, wallEndPoint(wall));
  }
  return points;
}

export function snapPoint(point: Point, targets: Point[], enabled = true): SnapResult<Point> {
  if (!enabled) return { value: point, guides: [] };
  let best = { x: Math.round(point.x / GRID_SIZE) * GRID_SIZE, y: Math.round(point.y / GRID_SIZE) * GRID_SIZE };
  let bestDistance = Math.hypot(best.x - point.x, best.y - point.y);
  for (const target of targets) {
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance < bestDistance && distance <= SNAP_THRESHOLD) {
      best = target;
      bestDistance = distance;
    }
  }
  const value = bestDistance <= SNAP_THRESHOLD ? best : point;
  return {
    value,
    guides: value === point ? [] : [{ axis: "x", value: value.x }, { axis: "y", value: value.y }],
  };
}

export function snapOpeningToRooms(rect: RectLike & { rotation?: number }, rooms: RectLike[], enabled = true) {
  if (!enabled || !rooms.length) return { x: rect.x, y: rect.y, rotation: rect.rotation ?? 0 };
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  let best: { distance: number; x: number; y: number; rotation: number } | null = null;
  for (const room of rooms) {
    const e = rectEdges(room);
    const candidates = [
      { distance: Math.abs(center.y - e.top), x: clamp(rect.x, e.left, e.right - rect.width), y: e.top - rect.height / 2, rotation: 0 },
      { distance: Math.abs(center.y - e.bottom), x: clamp(rect.x, e.left, e.right - rect.width), y: e.bottom - rect.height / 2, rotation: 0 },
      { distance: Math.abs(center.x - e.left), x: e.left - rect.width / 2, y: clamp(rect.y, e.top, e.bottom - rect.height), rotation: 90 },
      { distance: Math.abs(center.x - e.right), x: e.right - rect.width / 2, y: clamp(rect.y, e.top, e.bottom - rect.height), rotation: 90 },
    ];
    for (const candidate of candidates) {
      if (candidate.distance <= SNAP_THRESHOLD * 2 && (!best || candidate.distance < best.distance)) best = candidate;
    }
  }
  return best ? { x: best.x, y: best.y, rotation: best.rotation } : { x: rect.x, y: rect.y, rotation: rect.rotation ?? 0 };
}
