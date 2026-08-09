import type { ReadingRow } from "./queries/monitor";

/** 窗口内真实耗电（度）：只累加相邻读数的下降量，忽略充值跳升 */
export function usageBetween(rows: ReadingRow[]): number {
  let usage = 0;
  const okRows = rows.filter((r) => r.ok && r.elecKwh != null);
  for (let i = 1; i < okRows.length; i++) {
    const delta = okRows[i].elecKwh! - okRows[i - 1].elecKwh!;
    if (delta < 0) usage += -delta;
  }
  return Math.round(usage * 100) / 100;
}

/** 最近一次充值事件（电量跳升 ≥ 1 度） */
export function lastChargeEvent(rows: ReadingRow[]): { at: number; amount: number } | null {
  const okRows = rows.filter((r) => r.ok && r.elecKwh != null);
  for (let i = okRows.length - 1; i >= 1; i--) {
    const delta = okRows[i].elecKwh! - okRows[i - 1].elecKwh!;
    if (delta >= 1) {
      return { at: okRows[i].fetchedAt, amount: Math.round(delta * 100) / 100 };
    }
  }
  return null;
}

export type DormStats = {
  usage24h: number;
  usage7d: number;
  dailyAvg: number;
  daysRemaining: number | null;
  lastCharge: { at: number; amount: number } | null;
};

export function computeStats(rows7d: ReadingRow[], currentKwh: number | null, now = Date.now()): DormStats {
  const rows24h = rows7d.filter((r) => r.fetchedAt >= now - 24 * 3600_000);
  const usage24h = usageBetween(rows24h);
  const usage7d = usageBetween(rows7d);
  const dailyAvg = Math.round((usage7d / 7) * 100) / 100;
  const daysRemaining =
    currentKwh != null && currentKwh > 0 && dailyAvg > 0
      ? Math.round((currentKwh / dailyAvg) * 10) / 10
      : currentKwh != null && currentKwh <= 0
        ? 0
        : null;
  return { usage24h, usage7d, dailyAvg, daysRemaining, lastCharge: lastChargeEvent(rows7d) };
}
