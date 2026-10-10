import { desc, gte, eq, and, isNull } from "drizzle-orm";
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

export async function listDorms(): Promise<DormRow[]> {
  const rows = await getDb().select().from(dorms).orderBy(dorms.id);
  // 卡密码在静态加密存储，读出时统一解密；历史明文会被 decryptSecret 原样放行
  return rows.map((r) => ({ ...r, cardPass: decryptSecret(r.cardPass) }));
}

export async function createDorm(d: {
  name: string;
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

export async function latestReading(dormId?: number): Promise<ReadingRow | undefined> {
  if (dormId == null) {
    return getDb().query.readings.findFirst({ orderBy: [desc(readings.fetchedAt)] });
  }
  return getDb().query.readings.findFirst({
    where: eq(readings.dormId, dormId),
    orderBy: [desc(readings.fetchedAt)],
  });
}

export async function readingsSince(sinceMs: number, dormId?: number): Promise<ReadingRow[]> {
  const cond = dormId == null
    ? gte(readings.fetchedAt, sinceMs)
    : and(gte(readings.fetchedAt, sinceMs), eq(readings.dormId, dormId));
  return getDb().select().from(readings).where(cond).orderBy(readings.fetchedAt);
}

export async function recentReadings(limit: number, dormId?: number): Promise<ReadingRow[]> {
  const q = getDb().select().from(readings);
  if (dormId != null) q.where(eq(readings.dormId, dormId));
  return q.orderBy(desc(readings.fetchedAt)).limit(limit);
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
