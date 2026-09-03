export type Point = { x: number; y: number };
export type RectLike = { id?: number; x: number; y: number; width: number; height: number };
export type SnapGuide = { axis: "x" | "y"; value: number };

export const GRID_SIZE = 10;
export const SNAP_THRESHOLD = 12;
export const MIN_ROOM_SIZE = 80;
export const MIN_OBJECT_SIZE = 20;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function snapValue(value: number, targets: number[], enabled = true, threshold = SNAP_THRESHOLD) {
  if (!enabled) return value;
  let targetValue: number | null = null;
  let targetDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance < targetDistance && distance <= threshold) {
      targetValue = target;
      targetDistance = distance;
    }
  }
  if (targetValue !== null) return targetValue;
  const grid = Math.round(value / GRID_SIZE) * GRID_SIZE;
  return Math.abs(grid - value) <= threshold ? grid : value;
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

export function roomSnapTargets(rooms: RectLike[], excludeId?: number) {
  const x: number[] = [];
  const y: number[] = [];
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
) {
  const baseTargets = roomSnapTargets(rooms, rect.id);
  const targets = { x: [...baseTargets.x, ...extraTargets.x], y: [...baseTargets.y, ...extraTargets.y] };
  const candidatesX = [
    { position: rect.x, source: rect.x },
    { position: rect.x, source: rect.x + rect.width },
  ];
  const candidatesY = [
    { position: rect.y, source: rect.y },
    { position: rect.y, source: rect.y + rect.height },
  ];

  let x = rect.x;
  let y = rect.y;
  if (enabled) {
    for (const candidate of candidatesX) {
      const snapped = snapValue(candidate.source, targets.x, true);
      if (snapped !== candidate.source) {
        x += snapped - candidate.source;
        break;
      }
    }
    for (const candidate of candidatesY) {
      const snapped = snapValue(candidate.source, targets.y, true);
      if (snapped !== candidate.source) {
        y += snapped - candidate.source;
        break;
      }
    }
    x = snapValue(x, [], true);
    y = snapValue(y, [], true);
  }

  return {
    x: clamp(x, 0, Math.max(0, bounds.width - rect.width)),
    y: clamp(y, 0, Math.max(0, bounds.height - rect.height)),
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
) {
  const opposite = {
    nw: { x: rect.x + rect.width, y: rect.y + rect.height },
    ne: { x: rect.x, y: rect.y + rect.height },
    se: { x: rect.x, y: rect.y },
    sw: { x: rect.x + rect.width, y: rect.y },
  }[handle];
  const baseTargets = roomSnapTargets(rooms, rect.id);
  const targets = { x: [...baseTargets.x, ...extraTargets.x], y: [...baseTargets.y, ...extraTargets.y] };
  const snapped = {
    x: snapValue(clamp(point.x, 0, bounds.width), targets.x, enabled),
    y: snapValue(clamp(point.y, 0, bounds.height), targets.y, enabled),
  };

  let left = Math.min(opposite.x, snapped.x);
  let right = Math.max(opposite.x, snapped.x);
  let top = Math.min(opposite.y, snapped.y);
  let bottom = Math.max(opposite.y, snapped.y);

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
  return { x: left, y: top, width: right - left, height: bottom - top };
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

export function snapPoint(point: Point, targets: Point[], enabled = true) {
  if (!enabled) return point;
  let best = { x: Math.round(point.x / GRID_SIZE) * GRID_SIZE, y: Math.round(point.y / GRID_SIZE) * GRID_SIZE };
  let bestDistance = Math.hypot(best.x - point.x, best.y - point.y);
  for (const target of targets) {
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance < bestDistance && distance <= SNAP_THRESHOLD) {
      best = target;
      bestDistance = distance;
    }
  }
  return bestDistance <= SNAP_THRESHOLD ? best : point;
}
