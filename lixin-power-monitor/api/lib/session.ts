import crypto from "node:crypto";
import type { CookieOptions } from "hono/utils/cookie";
import { currentSessionInfo, readCookie } from "./sso";

/**
 * 本站自己的会话。
 *
 * 和课表站共享会话（SSO）是两套东西：
 *   - 课表站的 cookie 叫 lixin_jw_sid，Domain=.stellaura.tech，两个站共用
 *   - 本站的 cookie 叫 epower_sid，**主机专属**（不设 Domain），只给本站用
 *
 * 用户在登录页直接输学号密码时走这一套（由本站向学校统一身份认证核验）；
 * 从课表站跳过来时走共享会话那一套。两套都认。
 */

export const SESSION_COOKIE = "epower_sid";
export const SESSION_MAX_AGE_S = 30 * 24 * 3600; // 30 天

/** 派生密钥用的 salt —— 与课表站的 lixin-jw-session-v1 刻意分开 */
const SALT = "lixin-epower-session-v1";

let cachedKey: Buffer | null = null;
let cachedSecret: string | null = null;

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET missing");
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = crypto.scryptSync(secret, SALT, 32);
  cachedSecret = secret;
  return cachedKey;
}

const b64url = (b: Buffer) => b.toString("base64url");

export type SessionPayload = { sid: string; name: string | null };

export function signSession(studentId: string, name?: string | null): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = b64url(
    Buffer.from(
      JSON.stringify({
        sid: studentId,
        ...(name ? { name } : {}),
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S,
      }),
    ),
  );
  const sig = crypto.createHmac("sha256", key()).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

export function verifySession(token: string | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  const expected = crypto.createHmac("sha256", key()).update(`${h}.${p}`).digest();
  const actual = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;

  let payload: { sid?: unknown; name?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  try {
    const header = JSON.parse(Buffer.from(h.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (header.alg !== "HS256") return null; // 防 alg=none 降级
  } catch {
    return null;
  }
  if (typeof payload.sid !== "string" || !payload.sid) return null;
  return {
    sid: payload.sid,
    name: typeof payload.name === "string" && payload.name ? payload.name : null,
  };
}

/* ---------------- cookie 选项 ---------------- */

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

/** 本站会话 cookie 的选项：**不带 Domain**，只作用于本站主机 */
export function ownCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);
  return {
    httpOnly: true,
    path: "/",
    sameSite: localhost ? "Lax" : "None",
    secure: !localhost,
  };
}

/* ---------------- 统一入口 ---------------- */

export type CurrentSession = {
  studentId: string;
  name: string | null;
  via: "native" | "schedule";
};

/**
 * 取当前登录会话：先看本站自己的 cookie，再看课表站的共享会话。
 * 两条路都能用，所以「直接登录」和「从课表站跳过来」并存。
 */
export function currentSession(req: Request): CurrentSession | null {
  const own = verifySession(readCookie(req, SESSION_COOKIE));
  if (own) return { studentId: own.sid, name: own.name, via: "native" };

  const sso = currentSessionInfo(req);
  if (sso) return { studentId: sso.studentId, name: sso.name, via: "schedule" };

  return null;
}
