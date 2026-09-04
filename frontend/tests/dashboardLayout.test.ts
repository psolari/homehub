import test from "node:test";
import assert from "node:assert/strict";

import {
  dashboardRectsOverlap,
  findFreeDashboardPosition,
  resolveDashboardMove,
  resolveDashboardResize,
} from "../src/features/dashboard/dashboardLayout.ts";

const cards = [
  { id: 1, grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 3 },
  { id: 2, grid_x: 4, grid_y: 0, grid_w: 4, grid_h: 3 },
  { id: 3, grid_x: 8, grid_y: 0, grid_w: 4, grid_h: 3 },
];

test("dashboard cards detect overlap by grid cell", () => {
  assert.equal(
    dashboardRectsOverlap(cards[0], {
      id: 4,
      grid_x: 3,
      grid_y: 2,
      grid_w: 2,
      grid_h: 2,
    }),
    true,
  );
  assert.equal(dashboardRectsOverlap(cards[0], cards[1]), false);
});

test("dragging a card onto one neighbour swaps positions", () => {
  const next = resolveDashboardMove(cards, 1, 4, 0);
  const first = next.find((card) => card.id === 1)!;
  const second = next.find((card) => card.id === 2)!;

  assert.deepEqual(
    [first.grid_x, first.grid_y],
    [4, 0],
  );
  assert.deepEqual(
    [second.grid_x, second.grid_y],
    [0, 0],
  );
});

test("resizing refuses a shape that would overlap another card", () => {
  const next = resolveDashboardResize(cards, 1, {
    grid_x: 0,
    grid_y: 0,
    grid_w: 6,
    grid_h: 3,
  });
  assert.deepEqual(next, cards);
});

test("free slot search preserves existing cards and finds the next gap", () => {
  const next = findFreeDashboardPosition(
    {
      id: 4,
      grid_x: 0,
      grid_y: 0,
      grid_w: 4,
      grid_h: 3,
    },
    cards,
  );

  assert.deepEqual(
    [next.grid_x, next.grid_y],
    [0, 3],
  );
});
