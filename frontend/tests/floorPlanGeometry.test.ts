import test from "node:test";
import assert from "node:assert/strict";
import {
  resizeRect,
  snapPoint,
  snapRoomPosition,
  wallEndPoint,
  wallFromEndpoints,
} from "../src/features/floorplans/floorPlanGeometry.ts";

test("rooms snap edge-to-edge", () => {
  const existing = [{ id: 1, x: 100, y: 100, width: 300, height: 200 }];
  const moving = { id: 2, x: 406, y: 100, width: 200, height: 200 };
  const result = snapRoomPosition(moving, existing, { width: 1200, height: 800 }, true);
  assert.equal(result.x, 400);
  assert.equal(result.y, 100);
});

test("room corner resize snaps to another room edge", () => {
  const rooms = [
    { id: 1, x: 100, y: 100, width: 200, height: 200 },
    { id: 2, x: 305, y: 100, width: 200, height: 200 },
  ];
  const result = resizeRect(rooms[0], "se", { x: 306, y: 300 }, rooms, { width: 1200, height: 800 }, true);
  assert.equal(result.width, 205);
  assert.equal(result.height, 200);
});

test("wall endpoints round-trip through length and angle", () => {
  const wall = wallFromEndpoints({ x: 100, y: 100 }, { x: 200, y: 200 }, 12);
  const end = wallEndPoint({ ...wall, id: 1 });
  assert.ok(Math.abs(end.x - 200) < 0.001);
  assert.ok(Math.abs(end.y - 200) < 0.001);
});

test("wall endpoint snaps to a nearby room corner", () => {
  const point = snapPoint({ x: 104, y: 96 }, [{ x: 100, y: 100 }], true);
  assert.deepEqual(point, { x: 100, y: 100 });
});
