import { and, count, desc, gte, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { visitLogs } from "@db/schema";

/** 同一账号在此间隔内的重复访问不重复记流水（防刷新刷屏） */
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * 记录一次访问。
 * 5 分钟内同一学号只记一条，避免刷新页面时刷屏。
 * 仅保存身份快照，**不记录 IP 与设备信息**。
 */
export async function recordVisit(input: {
  studentId: string;
  realName?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const since = Date.now() - DEDUP_WINDOW_MS;

  const recent = await db
    .select({ id: visitLogs.id })
    .from(visitLogs)
    .where(and(eqStudent(input.studentId), gte(visitLogs.visitedAt, since)))
    .limit(1);

  if (recent.length > 0) return false;

  await db.insert(visitLogs).values({
    studentId: input.studentId,
    realName: input.realName ?? null,
    visitedAt: Date.now(),
  });
  return true;
}

function eqStudent(studentId: string) {
  return sql`${visitLogs.studentId} = ${studentId}`;
}

/** 时间区间内的统计：去重人数 + 访问次数 */
async function rangeStat(since?: number) {
  const db = getDb();
  const rows = await db
    .select({
      visits: count(),
      users: sql<number>`count(distinct ${visitLogs.studentId})`,
    })
    .from(visitLogs)
    .where(since === undefined ? undefined : gte(visitLogs.visitedAt, since));

  const r = rows[0];
  return {
    visits: Number(r?.visits ?? 0),
    users: Number(r?.users ?? 0),
  };
}

/** 总体统计：去重人数 + 总访问次数 */
export async function visitOverview() {
  return rangeStat();
}

/** 今日 / 近 7 天 / 近 30 天 */
export async function visitByPeriod() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d7 = Date.now() - 7 * 24 * 3600 * 1000;
  const d30 = Date.now() - 30 * 24 * 3600 * 1000;

  const [today, week, month] = await Promise.all([
    rangeStat(startOfToday),
    rangeStat(d7),
    rangeStat(d30),
  ]);

  return { today, week, month };
}

/** 按人聚合的名单：访问次数、首次 / 最近访问 */
export async function visitByUser(limit = 200) {
  const db = getDb();
  const rows = await db
    .select({
      studentId: visitLogs.studentId,
      realName: sql<string | null>`max(${visitLogs.realName})`,
      visits: count(),
      firstVisit: sql<number>`min(${visitLogs.visitedAt})`,
      lastVisit: sql<number>`max(${visitLogs.visitedAt})`,
    })
    .from(visitLogs)
    .groupBy(visitLogs.studentId)
    .orderBy(desc(sql`max(${visitLogs.visitedAt})`))
    .limit(limit);

  return rows.map((r) => ({
    studentId: r.studentId,
    realName: r.realName,
    visits: Number(r.visits),
    firstVisit: Number(r.firstVisit),
    lastVisit: Number(r.lastVisit),
  }));
}

/** 最近访问流水（管理员查看明细用） */
export async function recentVisits(limit = 60) {
  const db = getDb();
  const rows = await db
    .select({
      id: visitLogs.id,
      studentId: visitLogs.studentId,
      realName: visitLogs.realName,
      visitedAt: visitLogs.visitedAt,
    })
    .from(visitLogs)
    .orderBy(desc(visitLogs.visitedAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}
