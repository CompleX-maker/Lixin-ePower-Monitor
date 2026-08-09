import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import {
  latestReading,
  readingsSince,
  recentReadings,
  getSetting,
  setSetting,
  listDorms,
  createDorm,
  deleteDorm,
  updateDorm,
  rebindDormsByCardUser,
} from "./queries/monitor";
import { scrapeOnce, scrapeAll, manualRefresh, sendTestMail, schedulePoller } from "./poller";
import { computeStats } from "./stats";
import { cascade, withCascadeSession } from "./scraper";

const DAY = 24 * 3600 * 1000;

let lastOrigin: string | null = null;
/** 记录站点公网 origin（内存缓存，变化才写库） */
async function rememberOrigin(origin: string) {
  if (lastOrigin === origin) return;
  lastOrigin = origin;
  if ((await getSetting("public_origin")) !== origin) await setSetting("public_origin", origin);
}

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 4) return "****";
  return v.slice(0, 2) + "****" + v.slice(-2);
}

async function requireCreds(): Promise<{ username: string; password: string }> {
  const username = (await getSetting("ykt_username")) ?? "";
  const password = (await getSetting("ykt_password")) ?? "";
  if (!username || !password) throw new Error("请先在「设置」中填写一网通办账号和密码");
  return { username, password };
}

export const monitorRouter = createRouter({
  /* ---------------- 数据查询（可按宿舍过滤） ---------------- */
  current: publicQuery
    .input(z.object({ dormId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      // 顺手记录站点公网地址（保活自 ping 用）：前端每 60s 轮询本接口，有人访问就能学到 origin
      const host = ctx.req.headers.get("host");
      if (host && !host.includes("localhost") && !host.startsWith("127.")) {
        const proto = ctx.req.headers.get("x-forwarded-proto") ?? "https";
        void rememberOrigin(`${proto}://${host}`);
      }
      return (await latestReading(input?.dormId)) ?? null;
    }),

  stats: publicQuery
    .input(z.object({ dormId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const now = Date.now();
      const rows7d = await readingsSince(now - 7 * DAY, input?.dormId);
      const latest = await latestReading(input?.dormId);
      return computeStats(rows7d, latest?.ok ? latest.elecKwh : null, now);
    }),

  history: publicQuery
    .input(z.object({ hours: z.number().min(1).max(24 * 90).default(24), dormId: z.number().optional() }))
    .query(async ({ input }) => {
      const since = Date.now() - input.hours * 3600 * 1000;
      const rows = await readingsSince(since, input.dormId);
      return rows
        .filter((r) => r.ok)
        .map((r) => ({ t: r.fetchedAt, elec: r.elecKwh, card: r.cardBalance }));
    }),

  recent: publicQuery
    .input(z.object({ limit: z.number().min(1).max(200).default(30), dormId: z.number().optional() }))
    .query(async ({ input }) => {
      const rows = await recentReadings(input.limit, input.dormId);
      return rows.map((r) => ({
        id: Number(r.id),
        t: r.fetchedAt,
        elec: r.elecKwh,
        card: r.cardBalance,
        ok: r.ok,
        err: r.errMsg,
      }));
    }),

  /* ---------------- 宿舍管理 ---------------- */
  dorms: publicQuery.query(async () => {
    const rows = await listDorms();
    let acctErrs: Record<string, string> = {};
    try {
      acctErrs = JSON.parse((await getSetting("account_errors")) ?? "{}");
    } catch { /* 忽略解析失败 */ }
    return rows.map((d) => ({
      id: Number(d.id),
      name: d.name,
      sysid: d.sysid,
      areaid: d.areaid,
      buildid: d.buildid,
      roomid: d.roomid,
      roomLabel: d.roomLabel,
      emailTo: d.emailTo,
      cardUser: d.cardUser,
      hasCardPass: Boolean(d.cardPass),
      cardErr: d.cardUser ? (acctErrs[d.cardUser] ?? null) : null,
      createdAt: d.createdAt,
    }));
  }),

  addDorm: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(64),
        sysid: z.number(),
        areaid: z.number(),
        buildid: z.number(),
        roomid: z.union([z.number(), z.string().min(1).max(64)]), // 部分系统房间号是字符串
        roomLabel: z.string().max(64).optional(),
        emailTo: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const id = await createDorm({ ...input, emailTo: input.emailTo?.trim() || null });
      // 立即抓一轮，让新宿舍马上有数据（绕过手动刷新防抖）
      void scrapeAll().catch((e) => console.error("[router] addDorm 后抓取失败", e));
      return { ok: true, id: Number(id) };
    }),

  /** 编辑宿舍：备注名 / 专属邮箱 / 绑定一卡通（cardUser 传空串 = 解绑） */
  updateDorm: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(64).optional(),
        emailTo: z.string().max(256).optional(), // 传空串 = 清除专属邮箱
        cardUser: z.string().max(64).optional(),
        cardPass: z.string().max(256).optional(), // 不传 = 保持不变
      }),
    )
    .mutation(async ({ input }) => {
      const patch: { name?: string; emailTo?: string | null; cardUser?: string | null; cardPass?: string | null } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.emailTo !== undefined) patch.emailTo = input.emailTo.trim() || null;
      if (input.cardUser !== undefined) {
        const u = input.cardUser.trim();
        if (!u) {
          patch.cardUser = null;
          patch.cardPass = null; // 解绑
        } else {
          patch.cardUser = u;
          if (input.cardPass) patch.cardPass = input.cardPass;
        }
      }
      await updateDorm(input.id, patch);
      // 绑定关系变化后立即重抓一轮，刷新余额显示
      void scrapeAll().catch((e) => console.error("[router] updateDorm 后抓取失败", e));
      return { ok: true };
    }),

  removeDorm: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteDorm(input.id);
    return { ok: true };
  }),

  /* ---------------- 级联选择（添加宿舍，走学校接口） ---------------- */
  cascade: publicQuery
    .input(
      z.object({
        level: z.enum(["systems", "areas", "districts", "buildings", "floors", "rooms"]),
        sysid: z.number().optional(),
        areaid: z.number().optional(),
        districtid: z.number().optional(),
        buildid: z.number().optional(),
        floorid: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const { username, password } = await requireCreds();
      return withCascadeSession(username, password, async (sess) => {
        switch (input.level) {
          case "systems":
            return cascade.systems(sess);
          case "areas":
            return cascade.areas(sess, input.sysid!);
          case "districts":
            return cascade.districts(sess, input.sysid!, input.areaid!);
          case "buildings":
            return cascade.buildings(sess, input.sysid!, input.areaid!, input.districtid!);
          case "floors":
            return cascade.floors(sess, input.sysid!, input.areaid!, input.districtid!, input.buildid!);
          case "rooms":
            return cascade.rooms(
              sess, input.sysid!, input.areaid!, input.districtid!, input.buildid!, input.floorid!,
            );
        }
      });
    }),

  refresh: publicQuery.mutation(async () => manualRefresh()),

  /* ---------------- 设置 ---------------- */
  getSettings: publicQuery.query(async () => {
    const username = (await getSetting("ykt_username")) ?? "";
    const hasPassword = Boolean(await getSetting("ykt_password"));
    const threshold = parseFloat((await getSetting("threshold")) ?? "") || 10;
    const pollMinutes = parseInt((await getSetting("poll_minutes")) ?? "", 10) || 30;
    const sctKey = (await getSetting("sct_sendkey")) ?? "";
    const emailUser = (await getSetting("email_user")) ?? "";
    const emailTo = (await getSetting("email_to")) ?? "";
    const emailEnabled = (await getSetting("email_enabled")) === "1";
    const hasEmailPass = Boolean(await getSetting("email_pass"));
    let accountErrors: Record<string, string> = {};
    try {
      accountErrors = JSON.parse((await getSetting("account_errors")) ?? "{}");
    } catch { /* 忽略解析失败 */ }
    return {
      username,
      hasPassword,
      threshold,
      pollMinutes,
      sctKey: mask(sctKey),
      hasSctKey: Boolean(sctKey),
      emailUser,
      emailTo,
      emailEnabled,
      hasEmailPass,
      accountErrors,
    };
  }),

  updateCredentials: publicQuery
    .input(z.object({ username: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const oldUser = (await getSetting("ykt_username")) ?? "";
      await setSetting("ykt_username", input.username.trim());
      await setSetting("ykt_password", input.password);
      // 全局账密变更 → 同步更新绑定了旧账号的宿舍（如 520 绑的就是全局账号）
      if (oldUser) await rebindDormsByCardUser(oldUser, input.username.trim(), input.password);
      const results = await scrapeOnce();
      const bad = results.find((r) => !r.ok);
      return { ok: !bad, errMsg: bad?.errMsg ?? null };
    }),

  updateAlert: publicQuery
    .input(z.object({ threshold: z.number().min(0).max(1000), pollMinutes: z.number().min(5).max(24 * 60) }))
    .mutation(async ({ input }) => {
      await setSetting("threshold", String(input.threshold));
      await setSetting("poll_minutes", String(input.pollMinutes));
      await schedulePoller(); // 立即应用新轮询间隔
      return { ok: true };
    }),

  updateSct: publicQuery
    .input(z.object({ sendkey: z.string().max(128) }))
    .mutation(async ({ input }) => {
      await setSetting("sct_sendkey", input.sendkey.trim());
      return { ok: true };
    }),

  testSct: publicQuery.mutation(async () => {
    const sendkey = await getSetting("sct_sendkey");
    if (!sendkey) return { ok: false, errMsg: "尚未配置 SendKey" };
    try {
      const res = await fetch(`https://sctapi.ftqq.com/${sendkey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          title: "⚡ 电费监测站测试推送",
          desp: `推送通道正常 · ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`,
        }).toString(),
      });
      const json = (await res.json()) as { code?: number };
      return json.code === 0 ? { ok: true, errMsg: null } : { ok: false, errMsg: "Server酱返回异常" };
    } catch (e) {
      return { ok: false, errMsg: e instanceof Error ? e.message : String(e) };
    }
  }),

  /* ---------------- QQ 邮箱 ---------------- */
  updateEmail: publicQuery
    .input(
      z.object({
        emailUser: z.string().max(128),
        emailPass: z.string().max(128).optional(), // 不传 = 保持不变；传空串 = 清除
        emailTo: z.string().max(256),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      await setSetting("email_user", input.emailUser.trim());
      if (input.emailPass !== undefined) await setSetting("email_pass", input.emailPass.trim());
      await setSetting("email_to", input.emailTo.trim());
      await setSetting("email_enabled", input.enabled ? "1" : "0");
      return { ok: true };
    }),

  testEmail: publicQuery.mutation(async () => sendTestMail()),
});
