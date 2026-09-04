export const DASHBOARD_COLUMNS = 12;
export const DASHBOARD_MIN_W = 2;
export const DASHBOARD_MIN_H = 2;

export type DashboardRect = {
  id: number;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
};

export function clampDashboardRect(
  rect: DashboardRect,
  columns = DASHBOARD_COLUMNS,
): DashboardRect {
  const grid_w = Math.max(
    DASHBOARD_MIN_W,
    Math.min(columns, Math.round(rect.grid_w)),
  );
  const grid_h = Math.max(DASHBOARD_MIN_H, Math.round(rect.grid_h));
  return {
    ...rect,
    grid_w,
    grid_h,
    grid_x: Math.max(
      0,
      Math.min(columns - grid_w, Math.round(rect.grid_x)),
    ),
    grid_y: Math.max(0, Math.round(rect.grid_y)),
  };
}

export function dashboardRectsOverlap(
  left: DashboardRect,
  right: DashboardRect,
) {
  return !(
    left.grid_x + left.grid_w <= right.grid_x ||
    right.grid_x + right.grid_w <= left.grid_x ||
    left.grid_y + left.grid_h <= right.grid_y ||
    right.grid_y + right.grid_h <= left.grid_y
  );
}

export function collidingDashboardCards(
  candidate: DashboardRect,
  cards: DashboardRect[],
  excludeIds: number[] = [],
) {
  const excluded = new Set(excludeIds);
  return cards.filter(
    (card) =>
      !excluded.has(card.id) &&
      card.id !== candidate.id &&
      dashboardRectsOverlap(candidate, card),
  );
}

export function resolveDashboardMove(
  initialCards: DashboardRect[],
  movingId: number,
  desiredX: number,
  desiredY: number,
): DashboardRect[] {
  const moving = initialCards.find((card) => card.id === movingId);
  if (!moving) return initialCards;

  const candidate = clampDashboardRect({
    ...moving,
    grid_x: desiredX,
    grid_y: desiredY,
  });
  const collisions = collidingDashboardCards(candidate, initialCards, [
    movingId,
  ]);

  if (!collisions.length) {
    return initialCards.map((card) =>
      card.id === movingId ? candidate : card,
    );
  }

  if (collisions.length !== 1) return initialCards;

  const displaced = collisions[0];
  const swapped = clampDashboardRect({
    ...displaced,
    grid_x: moving.grid_x,
    grid_y: moving.grid_y,
  });
  const others = initialCards.filter(
    (card) => card.id !== movingId && card.id !== displaced.id,
  );

  if (collidingDashboardCards(swapped, others).length) {
    return initialCards;
  }

  return initialCards.map((card) => {
    if (card.id === movingId) return candidate;
    if (card.id === displaced.id) return swapped;
    return card;
  });
}

export function resolveDashboardResize(
  cards: DashboardRect[],
  cardId: number,
  next: Omit<DashboardRect, "id">,
): DashboardRect[] {
  const current = cards.find((card) => card.id === cardId);
  if (!current) return cards;

  const candidate = clampDashboardRect({ id: cardId, ...next });
  if (collidingDashboardCards(candidate, cards, [cardId]).length) {
    return cards;
  }

  return cards.map((card) => (card.id === cardId ? candidate : card));
}

export function packDashboardCards(
  cards: DashboardRect[],
  columns = DASHBOARD_COLUMNS,
): DashboardRect[] {
  const placed: DashboardRect[] = [];

  for (const card of cards) {
    const base = clampDashboardRect(card, columns);
    let found: DashboardRect | null = null;

    for (let y = 0; y < 200 && !found; y += 1) {
      for (let x = 0; x <= columns - base.grid_w; x += 1) {
        const candidate = {
          ...base,
          grid_x: x,
          grid_y: y,
        };
        if (!collidingDashboardCards(candidate, placed).length) {
          found = candidate;
          break;
        }
      }
    }

    placed.push(found || base);
  }

  return placed;
}

export function dashboardGridHeight(cards: DashboardRect[]) {
  return Math.max(
    3,
    ...cards.map((card) => card.grid_y + card.grid_h),
  );
}


export function findFreeDashboardPosition(
  card: DashboardRect,
  occupied: DashboardRect[],
  columns = DASHBOARD_COLUMNS,
): DashboardRect {
  const base = clampDashboardRect(card, columns);

  for (let y = 0; y < 200; y += 1) {
    for (let x = 0; x <= columns - base.grid_w; x += 1) {
      const candidate = {
        ...base,
        grid_x: x,
        grid_y: y,
      };
      if (!collidingDashboardCards(candidate, occupied).length) {
        return candidate;
      }
    }
  }

  return base;
}
