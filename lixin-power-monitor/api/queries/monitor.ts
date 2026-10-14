import { desc, gte, eq, and, isNull, inArray } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { getDb } from "./connection";
import { readings, settings, dorms } from "@db/schema";

export type ReadingRow = typeof readings.$inferSelect;
export type DormRow = typeof dorms.$inferSelect;

/* ---------- 宿舍 ---------- */
export const DEFAULT_DORM = {
  name: "我的宿舍",
  sysid: 3,
  areaid: 2,
  buildid: 2296,
  roomid: "2417",
  roomLabel: "6-520",
};

/**
 * 宿舍列表。
 * @param studentId 传入则只返回该学号绑定的宿舍（普通用户视角）；
 *                  不传则返回全部（供后台轮询与管理员使用）
 */
export async function listDorms(studentId?: string): Promise<DormRow[]> {
  const base = getDb().select().from(dorms);
  const rows = studentId
    ? await base.where(eq(dorms.cardUser, studentId)).orderBy(dorms.id)
    : await base.orderBy(dorms.id);
  // 卡密码在静态加密存储，读出时统一解密；历史明文会被 decryptSecret 原样放行
  return rows.map((r) => ({ ...r, cardPass: decryptSecret(r.cardPass) }));
}

/** 取某学号可访问的宿舍 id 列表 */
export async function dormIdsOf(studentId: string): Promise<number[]> {
  const rows = await getDb()
    .select({ id: dorms.id })
    .from(dorms)
    .where(eq(dorms.cardUser, studentId));
  return rows.map((r) => Number(r.id));
}

/** 待认领的宿舍（card_user 为空） */
export async function listUnclaimedDorms(): Promise<DormRow[]> {
  const rows = await getDb()
    .select()
    .from(dorms)
    .where(isNull(dorms.cardUser))
    .orderBy(dorms.id);
  return rows.map((r) => ({ ...r, cardPass: decryptSecret(r.cardPass) }));
}

/**
 * 认领宿舍：把 card_user 置为当前学号。
 * 用 WHERE 带 IS NULL 条件保证原子性 —— 并发认领时只有一个人能成功。
 * @returns 是否认领成功（false = 已被他人抢先）
 */
export async function claimDormAs(dormId: number, studentId: string): Promise<boolean> {
  const res = await getDb()
    .update(dorms)
    .set({ cardUser: studentId })
    .where(and(eq(dorms.id, dormId), isNull(dorms.cardUser)));
  return Number(res[0]?.affectedRows ?? 0) > 0;
}

/** 解除绑定（管理员用，把宿舍退回待认领状态） */
export async function releaseDorm(dormId: number): Promise<void> {
  await getDb().update(dorms).set({ cardUser: null }).where(eq(dorms.id, dormId));
}

/** 某学号当前名下的宿舍数量（「一个账号只能有一个宿舍」的配额校验用） */
/** 列出所有松江宿舍，供校内采集端拉取「要去哪些房间抄表」 */
export async function listSongjiangTargets(): Promise<
  { building: number; room: string; label: string; name: string }[]
> {
  const rows = await getDb()
    .select({
      building: dorms.buildid,
      room: dorms.roomid,
      label: dorms.roomLabel,
      name: dorms.name,
    })
    .from(dorms)
    .where(eq(dorms.source, "songjiang"))
    .orderBy(dorms.buildid, dorms.roomid);

  return rows.map((r) => ({
    building: Number(r.building),
    room: String(r.room),
    label: r.label ?? String(r.room),
    name: r.name,
  }));
}

/**
 * 按「楼号 + 房间号」找松江宿舍。
 * 采集端只知道这两个值，不知道数据库主键，所以用它们定位。
 */
export async function findSongjiangDorm(
  building: number,
  room: string,
): Promise<DormRow | undefined> {
  const rows = await getDb()
    .select()
    .from(dorms)
    .where(
      and(eq(dorms.source, "songjiang"), eq(dorms.buildid, building), eq(dorms.roomid, room)),
    )
    .limit(1);
  return rows[0];
}

export async function countDormsOf(studentId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: dorms.id })
    .from(dorms)
    .where(eq(dorms.cardUser, studentId));
  return rows.length;
}

/** 某个宿舍是否属于该学号 */
export async function dormBelongsTo(dormId: number, studentId: string): Promise<boolean> {
  const row = await getDb().query.dorms.findFirst({
    where: and(eq(dorms.id, dormId), eq(dorms.cardUser, studentId)),
  });
  return Boolean(row);
}

export async function createDorm(d: {
  name: string;
  source?: string;
  sysid: number;
  areaid: number;
  buildid: number;
  roomid: number | string;
  roomLabel?: string | null;
  emailTo?: string | null;
  cardUser?: string | null;
  cardPass?: string | null;
}): Promise<number> {
  const res = await getDb()
    .insert(dorms)
    .values({
      ...d,
      source: d.source ?? "ykt",
      roomid: String(d.roomid),
      roomLabel: d.roomLabel ?? null,
      emailTo: d.emailTo ?? null,
      cardUser: d.cardUser ?? null,
      cardPass: encryptSecret(d.cardPass) ?? null,
      createdAt: Date.now(),
    });
  return Number(res[0].insertId);
}

/** 更新宿舍的备注名 / 专属邮箱 / 绑定一卡通 */
export async function updateDorm(
  id: number,
  patch: { name?: string; emailTo?: string | null; cardUser?: string | null; cardPass?: string | null },
): Promise<void> {
  const set: Record<string, string | null> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.emailTo !== undefined) set.emailTo = patch.emailTo;
  if (patch.cardUser !== undefined) set.cardUser = patch.cardUser;
  if (patch.cardPass !== undefined) set.cardPass = encryptSecret(patch.cardPass);
  if (Object.keys(set).length === 0) return;
  await getDb().update(dorms).set(set).where(eq(dorms.id, id));
}

/** 全局账密变更时，同步更新所有绑定了旧账号的宿舍 */
export async function rebindDormsByCardUser(oldUser: string, newUser: string, newPass: string): Promise<void> {
  await getDb()
    .update(dorms)
    .set({ cardUser: newUser, cardPass: encryptSecret(newPass) })
    .where(eq(dorms.cardUser, oldUser));
}

export async function deleteDorm(id: number): Promise<void> {
  await getDb().delete(readings).where(eq(readings.dormId, id));
  await getDb().delete(dorms).where(eq(dorms.id, id));
}

/** 确保默认宿舍存在；历史无 dormId 的读数回填到默认宿舍。返回默认宿舍 id。 */
export async function ensureDefaultDorm(): Promise<number> {
  const all = await listDorms();
  let def = all.find(
    (d) => d.sysid === DEFAULT_DORM.sysid && d.roomid === DEFAULT_DORM.roomid,
  );
  if (!def) {
    const id = await createDorm(DEFAULT_DORM);
    def = { id, ...DEFAULT_DORM, roomLabel: DEFAULT_DORM.roomLabel, createdAt: Date.now() } as DormRow;
  }
  await getDb()
    .update(readings)
    .set({ dormId: def.id })
    .where(isNull(readings.dormId));
  return def.id;
}

/* ---------- 读数 ---------- */
export async function insertReading(r: {
  dormId: number;
  elecKwh: number | null;
  cardBalance: number | null;
  ok: boolean;
  errMsg?: string | null;
  fetchedAt: number;
}) {
  await getDb()
    .insert(readings)
    .values({ ...r, errMsg: r.errMsg ?? null });
}

/**
 * 宿舍过滤条件归一化。
 *
 * ⚠️ 这几个函数接受的是**数组**，但调用方很容易顺手传一个数字。
 * drizzle 的 `inArray(col, 1)` 会生成 `in 1` —— 这是**非法 SQL**，
 * 运行时才炸（ER_PARSE_ERROR），类型检查如果没跑到也会漏过去。
 * 所以这里统一收口：数字也接受，自动包成数组。
 */
type DormFilter = number | number[] | undefined;

function normalizeDormIds(f: DormFilter): number[] | undefined {
  if (f == null) return undefined;
  return Array.isArray(f) ? f : [f];
}

export async function latestReading(filter?: DormFilter): Promise<ReadingRow | undefined> {
  const dormIds = normalizeDormIds(filter);
  if (dormIds == null) {
    return getDb().query.readings.findFirst({ orderBy: [desc(readings.fetchedAt)] });
  }
  if (dormIds.length === 0) return undefined; // 无可访问宿舍
  return getDb().query.readings.findFirst({
    where: inArray(readings.dormId, dormIds),
    orderBy: [desc(readings.fetchedAt)],
  });
}

export async function readingsSince(sinceMs: number, filter?: DormFilter): Promise<ReadingRow[]> {
  const dormIds = normalizeDormIds(filter);
  if (dormIds != null && dormIds.length === 0) return [];
  const cond =
    dormIds == null
      ? gte(readings.fetchedAt, sinceMs)
      : and(gte(readings.fetchedAt, sinceMs), inArray(readings.dormId, dormIds));
  return getDb().select().from(readings).where(cond).orderBy(readings.fetchedAt);
}

export async function recentReadings(limit: number, filter?: DormFilter): Promise<ReadingRow[]> {
  const dormIds = normalizeDormIds(filter);
  if (dormIds != null && dormIds.length === 0) return [];
  if (dormIds != null) {
    return getDb()
      .select()
      .from(readings)
      .where(inArray(readings.dormId, dormIds))
      .orderBy(desc(readings.fetchedAt))
      .limit(limit);
  }
  return getDb().select().from(readings).orderBy(desc(readings.fetchedAt)).limit(limit);
}

/* ---------- 配置 KV ---------- */
/** 需要加密存储的设置项（含账号密码、邮箱授权码、推送 Key） */
const SENSITIVE_KEYS = new Set(["ykt_password", "email_pass", "sct_sendkey"]);

export async function getSetting(key: string): Promise<string | null> {
  const row = await getDb().query.settings.findFirst({ where: eq(settings.key, key) });
  if (!row?.value) return row?.value ?? null;
  return SENSITIVE_KEYS.has(key) ? decryptSecret(row.value) : row.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const stored = SENSITIVE_KEYS.has(key) ? encryptSecret(value) : value;
  await getDb()
    .insert(settings)
    .values({ key, value: stored })
    .onDuplicateKeyUpdate({ set: { value: stored } });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await getDb().select().from(settings);
  return Object.fromEntries(
    rows.map((r) => {
      const raw = r.value ?? "";
      const out = SENSITIVE_KEYS.has(r.key) ? (decryptSecret(raw) ?? "") : raw;
      return [r.key, out];
    }),
  );
}
