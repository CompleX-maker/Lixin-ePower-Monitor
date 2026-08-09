/**
 * 轮询器（号池 + 严格间隔版）
 * - 号池：全局账号 + 各宿舍绑定的一卡通账号。某账号出错自动换下一个账号抓电量；
 *   余额只走该宿舍自己绑定的账号（未绑定 → null → 显示「暂无」）。
 *   账号健康状态写入 settings.account_errors 供页面展示。
 * - 严格间隔：调度锚定「最近一次读数时间 + 间隔」，到点前的多余触发一律跳过；
 *   另有数据库租约兜底，多实例同时运行也不会重复抓取。
 * - 低于阈值：Server酱全局推一次 + 邮件发到该宿舍专属邮箱（无则发全局收件箱）。
 * - 每天 18:00（Asia/Shanghai）：每个配了专属邮箱的宿舍单独发一封日报；全局收件箱另发一封汇总。
 * 在 api/boot.ts 中 import 本模块即随服务启动。
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {
  getPooledSession,
  dropPooledSession,
  runWithAccount,
  fetchElecForDorm,
  fetchCardBalance,
  setDeviceId,
  getDeviceId,
  type Session,
} from "./scraper";
import {
  insertReading,
  getSetting,
  setSetting,
  latestReading,
  listDorms,
  ensureDefaultDorm,
  readingsSince,
  type DormRow,
} from "./queries/monitor";
import { computeStats } from "./stats";

const DEFAULT_POLL_MINUTES = 30;
const DEFAULT_THRESHOLD = 10;
const INSTANCE_ID = crypto.randomUUID(); // 本进程标识（租约用）
const LEASE_KEY = "poller_lease";
const LEASE_TTL = 3 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export type ScrapeResult = {
  ok: boolean;
  dormId: number;
  elecKwh: number | null;
  cardBalance: number | null;
  errMsg: string | null;
  fetchedAt: number;
};

type Account = { username: string; password: string };

const dormLabel = (d: DormRow) => `${d.name}${d.roomLabel ? `（${d.roomLabel}）` : ""}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------------- 通知通道 ---------------- */
async function sendServerChan(sendkey: string, title: string, desp: string) {
  try {
    await fetch(`https://sctapi.ftqq.com/${sendkey}.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title, desp }).toString(),
    });
  } catch (e) {
    console.error("[poller] Server酱推送失败", e);
  }
}

async function sendQQMail(
  subject: string,
  html: string,
  toOverride?: string | null,
): Promise<{ ok: boolean; errMsg: string | null }> {
  const user = await getSetting("email_user");
  const pass = await getSetting("email_pass");
  const to = toOverride || (await getSetting("email_to"));
  if (!user || !pass) return { ok: false, errMsg: "QQ邮箱未完整配置（发件邮箱/授权码）" };
  if (!to) return { ok: false, errMsg: "未配置收件邮箱" };
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transporter.sendMail({ from: `"电费监测站" <${user}>`, to, subject, html });
    return { ok: true, errMsg: null };
  } catch (e) {
    return { ok: false, errMsg: errMsg(e) };
  }
}

/* ---------------- 抓取（号池） ---------------- */
async function getCreds(): Promise<Account | null> {
  const username = await getSetting("ykt_username");
  const password = await getSetting("ykt_password");
  return username && password ? { username, password } : null;
}

async function saveReading(res: ScrapeResult, dorm?: DormRow) {
  await insertReading(res);
  if (res.ok && dorm) await maybeAlert(dorm, res);
}

/**
 * 抓全部宿舍并落库。
 * 1) 建池：逐个账号登录/复用探活，失败的记入 account_errors；
 * 2) 电量：依次用可用账号抓，失败换下一个（号池切换）；
 * 3) 余额：仅该宿舍绑定账号，取不到为 null（显示「暂无」）。
 */
export async function scrapeAll(): Promise<ScrapeResult[]> {
  await ensureDefaultDorm();
  const dorms = await listDorms();
  const global = await getCreds();
  const fetchedAt = Date.now();

  const savedDevice = await getSetting("device_id");
  if (savedDevice) setDeviceId(savedDevice);
  else await setSetting("device_id", getDeviceId());

  // 候选账号：全局优先，再各宿舍绑定账号（去重）
  const accs: Account[] = [];
  const seen = new Set<string>();
  const push = (a: Account | null) => {
    if (a && !seen.has(a.username)) {
      seen.add(a.username);
      accs.push(a);
    }
  };
  push(global);
  for (const d of dorms) if (d.cardUser && d.cardPass) push({ username: d.cardUser, password: d.cardPass });

  const failAll = async (msg: string) => {
    const out: ScrapeResult[] = [];
    for (const d of dorms) {
      const res: ScrapeResult = { ok: false, dormId: d.id, elecKwh: null, cardBalance: null, errMsg: msg, fetchedAt };
      await saveReading(res);
      out.push(res);
    }
    return out;
  };

  if (accs.length === 0) return failAll("尚未配置一卡通账号密码");

  // 建池探活
  const usable = new Map<string, Account>();
  const errs: Record<string, string> = {};
  for (const a of accs) {
    try {
      await getPooledSession(a.username, a.password);
      usable.set(a.username, a);
    } catch (e) {
      errs[a.username] = errMsg(e);
      console.error(`[poller] 账号 ${a.username} 登录失败：${errs[a.username]}`);
    }
  }

  if (usable.size === 0) {
    await setSetting("account_errors", JSON.stringify(errs));
    return failAll(`所有账号均登录失败（${Object.values(errs)[0] ?? "未知错误"}）`);
  }

  // 电量候选顺序：全局账号优先，其余按号池顺序
  const elecOrder = [
    ...(global && usable.has(global.username) ? [global.username] : []),
    ...[...usable.keys()].filter((u) => u !== global?.username),
  ];

  const results: ScrapeResult[] = [];
  for (const dorm of dorms) {
    // 余额：该宿舍绑定账号
    let card: number | null = null;
    if (dorm.cardUser && usable.has(dorm.cardUser)) {
      const a = usable.get(dorm.cardUser)!;
      card = await runWithAccount(a.username, a.password, (s) => fetchCardBalance(s)).catch(() => null);
    }
    // 电量：号池逐个尝试，出错切换
    let elec: number | null = null;
    let elecErr: string | null = null;
    for (const u of elecOrder) {
      const a = usable.get(u);
      if (!a) continue;
      try {
        elec = await runWithAccount(a.username, a.password, (s: Session) => fetchElecForDorm(s, dorm));
        elecErr = null;
        break;
      } catch (e) {
        elecErr = errMsg(e);
        dropPooledSession(u);
        usable.delete(u);
        errs[u] = elecErr;
        console.error(`[poller] 账号 ${u} 抓电量失败，切换下一个：${elecErr}`);
      }
    }
    const res: ScrapeResult = {
      ok: elec != null,
      dormId: dorm.id,
      elecKwh: elec,
      cardBalance: card,
      errMsg: elec != null ? null : (elecErr ?? "无可用账号"),
      fetchedAt,
    };
    await saveReading(res, dorm);
    results.push(res);
  }

  await setSetting("account_errors", JSON.stringify(errs));
  return results;
}

/** 兼容旧名：抓一次全部 */
export const scrapeOnce = scrapeAll;

/* ---------------- 阈值报警（越限只报一次；邮件路由到宿舍专属邮箱，兜底全局） ---------------- */
async function maybeAlert(dorm: DormRow, res: ScrapeResult) {
  if (!res.ok || res.elecKwh == null) return;
  const threshold = parseFloat((await getSetting("threshold")) ?? "") || DEFAULT_THRESHOLD;
  const stateKey = `alerted_below_${dorm.id}`;
  const alerted = (await getSetting(stateKey)) === "1";
  const below = res.elecKwh < threshold;
  const label = dormLabel(dorm);
  if (below && !alerted) {
    await setSetting(stateKey, "1");
    const title = `⚡ 电费告急：${label} 剩余 ${res.elecKwh} 度`;
    const cardText = res.cardBalance != null ? `${res.cardBalance} 元` : "暂无（未绑定一卡通）";
    const text = `宿舍 ${label} 剩余电量 ${res.elecKwh} 度，已低于阈值 ${threshold} 度。一卡通余额 ${cardText}，快去电控缴费！`;
    const sendkey = await getSetting("sct_sendkey");
    if (sendkey) await sendServerChan(sendkey, title, text);
    if ((await getSetting("email_enabled")) === "1") {
      const r = await sendQQMail(
        title,
        `<div style="font-family:sans-serif;padding:16px"><h3>${title}</h3><p>${text}</p></div>`,
        dorm.emailTo,
      );
      if (!r.ok) console.error(`[poller] 报警邮件发送失败（${label}）：${r.errMsg}`);
    }
  } else if (!below && alerted) {
    await setSetting(stateKey, "0");
  }
}

/* ---------------- QQ邮箱 每日 18:00 日报 ---------------- */
function shanghaiParts(d = new Date()): { date: string; hm: string } {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}

async function dormStatsRow(dorm: DormRow, threshold: number, now: number) {
  const last = await latestReading(dorm.id);
  const rows7d = await readingsSince(now - 7 * 24 * 3600_000, dorm.id);
  const cur = last?.ok && last.elecKwh != null ? last.elecKwh : null;
  const st = computeStats(rows7d, cur, now);
  const below = cur != null && cur < threshold;
  const color = cur == null ? "#71717a" : below ? "#ef4444" : "#059669";
  const cardText = last?.cardBalance != null ? `${last.cardBalance.toFixed(2)} 元` : "暂无";
  return { last, cur, st, color, cardText };
}

/** 全局汇总日报（所有宿舍一张表） */
export async function buildDailyReportHtml(): Promise<string> {
  const dorms = await listDorms();
  const threshold = parseFloat((await getSetting("threshold")) ?? "") || DEFAULT_THRESHOLD;
  const now = Date.now();
  const rowsHtml: string[] = [];
  for (const dorm of dorms) {
    const { cur, st, color, cardText } = await dormStatsRow(dorm, threshold, now);
    rowsHtml.push(`<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${dormLabel(dorm)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${color};font-weight:700">${cur == null ? "抓取失败" : cur.toFixed(2) + " 度"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${st.usage24h} 度</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${st.dailyAvg} 度/天</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${st.daysRemaining == null ? "—" : st.daysRemaining + " 天"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${cardText}</td>
    </tr>`);
  }
  const { date, hm } = shanghaiParts();
  return `<div style="font-family:sans-serif;max-width:640px;margin:auto;padding:20px;background:#fafafa;border-radius:12px">
    <h2 style="margin:0 0 4px">⚡ 电费监测日报</h2>
    <p style="color:#888;margin:0 0 16px">${date} ${hm} · 阈值 ${threshold} 度</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
      <tr style="background:#f4f4f5;text-align:left">
        <th style="padding:8px 12px">宿舍</th><th style="padding:8px 12px">剩余电量</th>
        <th style="padding:8px 12px">24h耗电</th><th style="padding:8px 12px">日均</th>
        <th style="padding:8px 12px">预计可用</th><th style="padding:8px 12px">一卡通余额</th>
      </tr>
      ${rowsHtml.join("")}
    </table>
    <p style="color:#aaa;font-size:12px;margin-top:16px">电费监测站自动发送 · 低于阈值时另有即时报警</p>
  </div>`;
}

/** 单个宿舍的专属日报 */
export async function buildDormReportHtml(dorm: DormRow): Promise<string> {
  const threshold = parseFloat((await getSetting("threshold")) ?? "") || DEFAULT_THRESHOLD;
  const now = Date.now();
  const { cur, st, color, cardText } = await dormStatsRow(dorm, threshold, now);
  const { date, hm } = shanghaiParts();
  const below = cur != null && cur < threshold;
  return `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:20px;background:#fafafa;border-radius:12px">
    <h2 style="margin:0 0 4px">⚡ ${dormLabel(dorm)} 电费日报</h2>
    <p style="color:#888;margin:0 0 16px">${date} ${hm} · 阈值 ${threshold} 度</p>
    <div style="background:#fff;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:42px;font-weight:800;color:${color}">${cur == null ? "抓取失败" : cur.toFixed(2) + " 度"}</div>
      ${below ? `<div style="color:#ef4444;font-size:13px;margin-top:4px">已低于阈值，记得充值！</div>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:12px">
      <tr><td style="padding:8px 12px;color:#888">24h 耗电</td><td style="padding:8px 12px;text-align:right;font-weight:600">${st.usage24h} 度</td></tr>
      <tr><td style="padding:8px 12px;color:#888;border-top:1px solid #eee">近7天日均</td><td style="padding:8px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${st.dailyAvg} 度/天</td></tr>
      <tr><td style="padding:8px 12px;color:#888;border-top:1px solid #eee">预计可用</td><td style="padding:8px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${st.daysRemaining == null ? "—" : st.daysRemaining + " 天"}</td></tr>
      <tr><td style="padding:8px 12px;color:#888;border-top:1px solid #eee">一卡通余额</td><td style="padding:8px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${cardText}</td></tr>
    </table>
    <p style="color:#aaa;font-size:12px;margin-top:16px">电费监测站自动发送 · 余额为该宿舍绑定的一卡通，未绑定显示暂无</p>
  </div>`;
}

/** 到点检查（每分钟一次）：过了今天 18:00 且今天没发过就发 */
async function dailyMailTick() {
  if ((await getSetting("email_enabled")) !== "1") return;
  const { date, hm } = shanghaiParts();
  if (hm < "18:00") return;
  const dorms = await listDorms();

  for (const dorm of dorms) {
    if (!dorm.emailTo) continue;
    const key = `last_email_date_dorm_${dorm.id}`;
    if ((await getSetting(key)) === date) continue;
    const r = await sendQQMail(`⚡ 电费日报 ${date} · ${dormLabel(dorm)}`, await buildDormReportHtml(dorm), dorm.emailTo);
    if (r.ok) {
      await setSetting(key, date);
      console.log(`[poller] 宿舍专属日报已发送 ${date} → ${dormLabel(dorm)}`);
    } else {
      console.error(`[poller] 宿舍专属日报发送失败（${dormLabel(dorm)}）：${r.errMsg}`);
    }
  }

  if ((await getSetting("last_email_date")) !== date) {
    const r = await sendQQMail(`⚡ 电费日报 ${date}`, await buildDailyReportHtml());
    if (r.ok) {
      await setSetting("last_email_date", date);
      console.log(`[poller] 汇总日报已发送 ${date}`);
    } else {
      console.error(`[poller] 汇总日报发送失败：${r.errMsg}`);
    }
  }
}

/* ---------------- 调度：锚定上次读数的严格间隔 + 租约防多实例重复 ---------------- */
async function newestReadingAt(): Promise<number> {
  const r = await latestReading();
  return r?.fetchedAt ?? 0;
}

export async function currentPollMinutes(): Promise<number> {
  return parseInt((await getSetting("poll_minutes")) ?? "", 10) || DEFAULT_POLL_MINUTES;
}

/** 获取抓租约：多实例同时在线时，只有持有租约的实例真正抓取 */
async function acquireLease(): Promise<boolean> {
  const now = Date.now();
  try {
    const cur = await getSetting(LEASE_KEY);
    if (cur) {
      const lease = JSON.parse(cur) as { owner: string; exp: number };
      if (lease.owner !== INSTANCE_ID && lease.exp > now) return false;
    }
    await setSetting(LEASE_KEY, JSON.stringify({ owner: INSTANCE_ID, exp: now + LEASE_TTL }));
    const chk = JSON.parse((await getSetting(LEASE_KEY))!) as { owner: string };
    return chk.owner === INSTANCE_ID;
  } catch {
    return true; // 租约机制故障时宁可抓取，也不停摆
  }
}

async function tick(force = false) {
  if (running) return;
  // 间隔未到一律跳过（兜底：多余定时器/服务重启/其他实例触发都不会产生额外读数）
  if (!force) {
    const mins = await currentPollMinutes();
    const last = await newestReadingAt();
    if (last && Date.now() - last < (mins - 0.5) * 60_000) return;
  }
  if (!(await acquireLease())) return;
  running = true;
  try {
    const rs = await scrapeAll();
    console.log(`[poller] ${new Date().toISOString()} ${rs.map((r) => `#${r.dormId}:${r.ok ? r.elecKwh + "度" : "失败"}`).join(" ")}`);
  } finally {
    running = false;
  }
}

/** 自我锚定调度：下一次触发 = 最近读数时间 + 间隔，与页面倒计时一致 */
async function scheduleNext() {
  if (timer) clearTimeout(timer);
  const mins = await currentPollMinutes();
  const last = await newestReadingAt();
  const due = last > 0 ? last + mins * 60_000 : Date.now();
  const delay = Math.max(5_000, due - Date.now());
  timer = setTimeout(() => {
    void tick().finally(() => void scheduleNext());
  }, delay);
  console.log(`[poller] 间隔 ${mins} 分钟，下次抓取约在 ${new Date(Date.now() + delay).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`);
}

export async function schedulePoller() {
  await scheduleNext();
}

/** 手动刷新（60 秒防抖） */
export async function manualRefresh() {
  const newest = await newestReadingAt();
  if (newest && Date.now() - newest < 60_000) return { skipped: true, results: null };
  await tick(true);
  void scheduleNext(); // 手动抓取后重新锚定
  return { skipped: false, results: null };
}

/** 日报测试（立即发一封汇总到全局收件箱） */
export async function sendTestMail() {
  return sendQQMail("⚡ 电费监测站测试邮件", await buildDailyReportHtml());
}

// 服务启动：开轮询 + 每分钟检查日报（首次抓取由 scheduleNext 按数据新旧自动决定）
void schedulePoller();
setInterval(() => void dailyMailTick().catch((e) => console.error("[poller] dailyMailTick", e)), 60_000);

/* ---------------- 保活 ----------------
 * 平台在无人访问时会休眠容器，导致定时任务停摆。
 * 这里每 4 分钟自 ping 一次公网地址（由 monitorRouter 在有人访问时自动记录），
 * 让容器保持清醒，轮询和 18:00 日报才能准点运行。
 */
async function keepAlivePing() {
  const origin = await getSetting("public_origin");
  if (!origin) return;
  try {
    await fetch(`${origin}/api/trpc/ping`, { signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    console.error("[keepalive] 自 ping 失败：", errMsg(e));
  }
}
setInterval(() => void keepAlivePing().catch(() => {}), 4 * 60_000);
