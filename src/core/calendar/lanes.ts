export interface BarItem {
  id: string | number;
  startDate: string;
  endDate: string;
}

export interface Bar<T> {
  item: T;
  /** 0-based columns inside the week row, inclusive. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The holiday started before this row / ends after it (draw a flat edge or arrow). */
  continuesLeft: boolean;
  continuesRight: boolean;
}

export interface WeekLayout<T> {
  bars: Bar<T>[]; // only lanes < maxLanes
  lanes: number; // number of lanes used by `bars`
  more: number[]; // per column: bars hidden in lanes >= maxLanes
}

/**
 * Lays holidays out as spanning bars for one week row (`week` = its 7 dates, in order).
 * Sorted by start date, longer first, then id; each bar takes the lowest lane that is free
 * on all its days in this row. Items not touching the row are ignored.
 */
export function layoutWeek<T extends BarItem>(
  week: string[],
  items: T[],
  maxLanes = Infinity,
): WeekLayout<T> {
  const first = week[0]!;
  const last = week[week.length - 1]!;
  const span = (x: BarItem) => {
    const s = x.startDate < first ? first : x.startDate;
    const e = x.endDate > last ? last : x.endDate;
    return { s, e, a: week.indexOf(s), b: week.indexOf(e) };
  };

  const inRow = items
    .filter((x) => x.startDate <= last && x.endDate >= first)
    .sort(
      (p, q) =>
        p.startDate.localeCompare(q.startDate) ||
        q.endDate.localeCompare(p.endDate) || // longer first
        String(p.id).localeCompare(String(q.id)),
    );

  const taken: boolean[][] = []; // taken[lane][col]
  const all: Bar<T>[] = [];
  for (const item of inRow) {
    const { a, b } = span(item);
    let lane = 0;
    while ((taken[lane] ??= []).slice(a, b + 1).some(Boolean)) lane++;
    for (let c = a; c <= b; c++) taken[lane]![c] = true;
    all.push({
      item,
      startCol: a,
      endCol: b,
      lane,
      continuesLeft: item.startDate < first,
      continuesRight: item.endDate > last,
    });
  }

  const bars = all.filter((x) => x.lane < maxLanes);
  const more = week.map(() => 0);
  for (const x of all) {
    if (x.lane >= maxLanes) for (let c = x.startCol; c <= x.endCol; c++) more[c]!++;
  }
  return { bars, lanes: bars.reduce((n, x) => Math.max(n, x.lane + 1), 0), more };
}
