/**
 * 立信一卡通 ePay 电费抓取器（多宿舍版）
 *
 * 纯 HTTP 复刻浏览器登录链路（已逐跳验证）：
 *   1. GET  CAS 登录页           -> 取 execution 令牌
 *   2. GET  /cas/jwt/publicKey   -> RSA 公钥，PKCS1v15 加密密码，加 "__RSA__" 前缀
 *   3. POST /cas/login           -> 302 链 -> aTrust 回换 sid
 *   4. POST /controller/v1/public/reportEnv  (ticket=sid, deviceId, env.endpoint)
 *   5. GET  /passport/v1/auth/authCheck      -> code 0 = 登录态就绪
 *   6. GET  ykt /epay/h5/*       -> 网关 verify 跳转链 -> 服务端渲染数据页 / .json 接口
 * 会话失效（互踢/超时）时整体重登一次再试。登录后任意宿舍均可查询（电控缴费本就不限本人房间）。
 */
import crypto from "node:crypto";

const CAS_BASE = "https://cas.paas.lixin.edu.cn";
const ATRUST_BASE = "https://atrust.lixin.edu.cn";
const YKT_BASE = "http://ykt.lixin.edu.cn";
const CAS_SERVICE = encodeURIComponent(
  `${ATRUST_BASE}:443/passport/v1/auth/cas?sfDomain=paas.lixin.edu.cn`,
);
const CAS_LOGIN_URL = `${CAS_BASE}/cas/login?service=${CAS_SERVICE}`;
const INDEX_URL = `${YKT_BASE}/epay/h5/index`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type DormParams = { sysid: number; areaid: number; buildid: number; roomid: number | string };

export function elecResultUrl(d: DormParams): string {
  return `${YKT_BASE}/epay/h5/eleresult?sysid=${d.sysid}&roomid=${d.roomid}&areaid=${d.areaid}&buildid=${d.buildid}`;
}

/* ---------------- 极简 Cookie Jar（按域存储，随请求自动携带） ---------------- */
class CookieJar {
  private store = new Map<string, Map<string, string>>();

  setFromResponse(res: Response, url: URL) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const first = sc.split(";")[0];
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      const domainAttr = /;\s*domain=\.?([^;\s]+)/i.exec(sc)?.[1];
      const domain = (domainAttr ?? url.host).toLowerCase();
      if (!this.store.has(domain)) this.store.set(domain, new Map());
      this.store.get(domain)!.set(name, value);
    }
  }

  headerFor(url: URL): string | undefined {
    const host = url.host.toLowerCase();
    const pairs: string[] = [];
    for (const [domain, cookies] of this.store) {
      if (host === domain || host.endsWith("." + domain)) {
        for (const [n, v] of cookies) pairs.push(`${n}=${v}`);
      }
    }
    return pairs.length ? pairs.join("; ") : undefined;
  }

  get(domain: string, name: string): string | undefined {
    return this.store.get(domain)?.get(name);
  }
}

/* ---------------- 基础请求：手动处理重定向以便收集 Cookie ---------------- */
type Hop = { status: number; location: string | null; text: string };

async function rawRequest(
  jar: CookieJar,
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Hop> {
  const u = new URL(url);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9",
    ...opts.headers,
  };
  const cookie = jar.headerFor(u);
  if (cookie) headers["Cookie"] = cookie;

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
    redirect: "manual",
  });
  jar.setFromResponse(res, u);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), text };
}

/** 跟随 30x 与页面内 JS 跳转（locationUrl），直到拿到最终页面 */
async function followChain(
  jar: CookieJar,
  startUrl: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
  maxHops = 8,
): Promise<Hop> {
  let url = startUrl;
  let method = opts.method ?? "GET";
  let body = opts.body;
  for (let i = 0; i < maxHops; i++) {
    const hop = await rawRequest(jar, url, { method, headers: opts.headers, body });
    if ([301, 302, 303, 307, 308].includes(hop.status) && hop.location) {
      url = new URL(hop.location, url).toString();
      method = "GET";
      body = undefined;
      continue;
    }
    const m = /locationUrl\s*=\s*"([^"]+)"/.exec(hop.text);
    if (m && hop.text.length < 4000) {
      url = new URL(m[1].replaceAll("\\/", "/"), url).toString();
      method = "GET";
      body = undefined;
      continue;
    }
    return hop;
  }
  throw new Error("重定向链过长");
}

/* ---------------- 登录 ---------------- */
export type Session = { jar: CookieJar };

let sessionDeviceId = crypto.randomBytes(32).toString("hex");

export function setDeviceId(id: string) {
  sessionDeviceId = id;
}
export function getDeviceId() {
  return sessionDeviceId;
}

function extract(regex: RegExp, text: string, what: string): string {
  const m = regex.exec(text);
  if (!m) throw new Error(`页面中未找到 ${what}`);
  return m[1];
}

async function login(username: string, password: string): Promise<Session> {
  const jar = new CookieJar();

  const page1 = await rawRequest(jar, CAS_LOGIN_URL);
  const execution = extract(/name="execution" value="([^"]+)"/, page1.text, "execution");

  const pkRes = await rawRequest(jar, `${CAS_BASE}/cas/jwt/publicKey`);
  let pk = pkRes.text.trim();
  if (!pk.startsWith("-----")) {
    pk = `-----BEGIN PUBLIC KEY-----\n${pk.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;
  }
  const encPwd =
    "__RSA__" +
    crypto
      .publicEncrypt(
        { key: pk, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(password),
      )
      .toString("base64");

  const form = new URLSearchParams({
    username,
    password: encPwd,
    captcha: "",
    mfaState: "",
    currentMenu: "1",
    failN: "-1",
    execution,
    _eventId: "submit",
  }).toString();
  await followChain(jar, CAS_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const sid = jar.get("atrust.lixin.edu.cn", "sid");
  if (!sid) throw new Error("CAS 登录失败：未获得 aTrust sid（账密错误？）");

  const qs = "clientType=SDPBrowserClient&platform=Linux&lang=zh-CN";
  const rep = await rawRequest(jar, `${ATRUST_BASE}/controller/v1/public/reportEnv?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticket: sid,
      deviceId: sessionDeviceId,
      env: { endpoint: { device_id: sessionDeviceId, device: { type: "browser" } } },
    }),
  });
  if (rep.status !== 200 || !rep.text.includes('"code":0')) {
    throw new Error(`reportEnv 失败：${rep.status} ${rep.text.slice(0, 120)}`);
  }

  const chk = await rawRequest(jar, `${ATRUST_BASE}/passport/v1/auth/authCheck?${qs}`);
  if (!chk.text.includes('"code":0')) {
    throw new Error(`authCheck 未通过：${chk.text.slice(0, 120)}`);
  }
  return { jar };
}

/** 确保 ykt 侧会话已建立（触发一次网关 verify） */
async function warmYkt(sess: Session) {
  const hop = await followChain(sess.jar, INDEX_URL, {
    headers: { Referer: `${YKT_BASE}/epay/h5/payele` },
  });
  if (!hop.text.includes("账户余额")) {
    throw new Error("ykt 会话预热失败");
  }
}

/* ---------------- 账号会话池（号池） ----------------
 * 每个账号一条会话，按 username 复用；fetch 失败时调用方 dropPooledSession 后重新获取（即重新登录）。
 * 多账号场景（每个宿舍可绑各自一卡通）下不会串用别人的会话。
 */
const sessionPool = new Map<string, Session>();

export async function getPooledSession(username: string, password: string): Promise<Session> {
  const s = sessionPool.get(username);
  if (s) return s;
  const ns = await login(username, password);
  sessionPool.set(username, ns);
  return ns;
}

export function dropPooledSession(username: string) {
  sessionPool.delete(username);
}

/** 带重试的账号执行器：会话失效 → 丢弃重登一次再试；账密错误会在 login 处抛出 */
export async function runWithAccount<T>(
  username: string,
  password: string,
  fn: (sess: Session) => Promise<T>,
): Promise<T> {
  const s = await getPooledSession(username, password);
  try {
    return await fn(s);
  } catch {
    dropPooledSession(username);
    const s2 = await getPooledSession(username, password);
    return await fn(s2);
  }
}

/* ---------------- 数据抓取 ---------------- */
function parseElec(html: string): number {
  const m = /剩余电量[\s\S]{0,300}?(-?\d+(?:\.\d+)?)\s*度/.exec(html);
  if (!m) throw new Error("未解析到剩余电量");
  return parseFloat(m[1]);
}

function parseBalance(html: string): number | null {
  const m = /账户余额[\s\S]{0,300}?(-?\d+(?:\.\d+)?)\s*元/.exec(html);
  return m ? parseFloat(m[1]) : null;
}

export async function fetchElecForDorm(sess: Session, dorm: DormParams): Promise<number> {
  const hop = await followChain(sess.jar, elecResultUrl(dorm), {
    headers: { Referer: `${YKT_BASE}/epay/h5/payele` },
  });
  if (!hop.text.includes("剩余电量")) throw new Error("电费页未返回数据");
  return parseElec(hop.text);
}

export async function fetchCardBalance(sess: Session): Promise<number | null> {
  const hop = await followChain(sess.jar, INDEX_URL, {
    headers: { Referer: `${YKT_BASE}/epay/h5/payele` },
  });
  return parseBalance(hop.text);
}

/* ---------------- 级联列表（添加宿舍用，GET + XHR 头，实测 POST 会被拒） ---------------- */
async function fetchCascade<T extends Record<string, unknown>>(
  sess: Session,
  endpoint: string,
  params: Record<string, string | number>,
  idKey: keyof T & string,
  nameKey: keyof T & string,
): Promise<{ id: string; name: string; raw: T }[]> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );
  qs.set("_", String(Date.now()));
  const hop = await rawRequest(sess.jar, `${YKT_BASE}/epay/h5/${endpoint}?${qs}`, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${YKT_BASE}/epay/h5/payele`,
    },
  });
  let json: { retcode?: string; list?: T[] | null };
  try {
    json = JSON.parse(hop.text);
  } catch {
    throw new Error(`${endpoint} 未返回 JSON（会话失效？）`);
  }
  if (json.retcode !== "0" || !Array.isArray(json.list)) {
    throw new Error(`${endpoint} 返回异常`);
  }
  return json.list.map((item) => ({
    id: String(item[idKey]),
    name: String(item[nameKey]).trim(),
    raw: item,
  }));
}

export const cascade = {
  /** 电控系统列表（中山西路及上川路 / 新苑一二三） */
  systems: (sess: Session) =>
    fetchCascade<{ elcsysid: string; elcname: string }>(sess, "getelesys.json", {}, "elcsysid", "elcname"),
  areas: (sess: Session, sysid: number) =>
    fetchCascade<{ areaId: string; areaName: string }>(sess, "getarea.json", { sysid }, "areaId", "areaName"),
  districts: (sess: Session, sysid: number, areaid: number) =>
    fetchCascade<{ districtId: string; districtName: string }>(
      sess, "getdistrict.json", { sysid, areaid }, "districtId", "districtName"),
  buildings: (sess: Session, sysid: number, areaid: number, districtid: number) =>
    fetchCascade<{ buiId: string; buiName: string }>(
      sess, "getbuild.json", { sysid, areaid, districtid }, "buiId", "buiName"),
  floors: (sess: Session, sysid: number, areaid: number, districtid: number, buildid: number) =>
    fetchCascade<{ floorId: string; floorName: string }>(
      sess, "getfloor.json", { sysid, areaid, districtid, buildid }, "floorId", "floorName"),
  rooms: (sess: Session, sysid: number, areaid: number, districtid: number, buildid: number, floorid: number) =>
    fetchCascade<{ roomId: string; roomName: string }>(
      sess, "getroom.json", { sysid, areaid, districtid, buildid, floorid }, "roomId", "roomName"),
};

/** 级联选择需要已登录且预热过的 ykt 会话（走号池，失效自动重登） */
export async function withCascadeSession<T>(
  username: string,
  password: string,
  fn: (sess: Session) => Promise<T>,
): Promise<T> {
  return runWithAccount(username, password, async (sess) => {
    await warmYkt(sess);
    return fn(sess);
  });
}

/* ---------------- 本站登录用：核验账密并读取账户信息 ---------------- */

/**
 * 从 weui 单元格里取一个字段。页面结构很规整：
 *   <p>姓名</p></div><div class="weui-cell__ft">辛才豪</div>
 */
function parseWeuiCell(html: string, label: string): string | null {
  const re = new RegExp(
    `<p>\\s*${label}\\s*</p>\\s*</div>\\s*<div class="weui-cell__ft">\\s*([^<]*?)\\s*</div>`,
  );
  const v = re.exec(html)?.[1]?.trim();
  return v ? v : null;
}

export type AccountProfile = {
  studentId: string | null;
  name: string | null;
  college: string | null;
  className: string | null;
};

/** 读取「账户信息」页（姓名 / 学工号 / 学校 / 班级）。失败不影响登录本身。 */
export async function fetchAccountProfile(sess: Session): Promise<AccountProfile> {
  try {
    const hop = await followChain(sess.jar, `${YKT_BASE}/epay/h5/accountinfo`, {
      headers: { Referer: INDEX_URL },
    });
    return {
      studentId: parseWeuiCell(hop.text, "学工号"),
      name: parseWeuiCell(hop.text, "姓名"),
      college: parseWeuiCell(hop.text, "学校"),
      className: parseWeuiCell(hop.text, "班级"),
    };
  } catch {
    return { studentId: null, name: null, college: null, className: null };
  }
}

/**
 * 核验账密是否有效，并顺带取回姓名。
 *
 * 仅用于本站自己的登录入口：**核验完即丢，绝不保存密码**。
 * 抓取宿舍读数用的是号池里的公共账号，与登录者本人无关。
 * 账密错误会抛错（由调用方转成友好文案）。
 */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<AccountProfile> {
  const sess = await login(username, password);
  const profile = await fetchAccountProfile(sess);
  return { ...profile, studentId: profile.studentId ?? username };
}
