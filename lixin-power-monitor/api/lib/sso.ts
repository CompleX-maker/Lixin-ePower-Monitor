import crypto from "node:crypto";

/**
 * 单点登录（SSO）：复用课表站（stellaura.tech）的会话
 *
 * 课表站登录成功后签发 JWT 写入 httpOnly cookie，cookie 的 Domain 为
 * `.stellaura.tech`，因此本子域（epower.stellaura.tech）也能读到它。
 *
 * 约定（必须与课表站保持一致）：
 *   cookie 名 ：lixin_jw_sid
 *   JWT 载荷  ：{ sid: <学号> }
 *   算法      ：HS256
 *   密钥      ：scrypt(SSO_SECRET, "lixin-jw-session-v1", 32)
 *               其中 SSO_SECRET = 课表站的 APP_SECRET
 *
 * 这里用 node:crypto 手工验签，避免为一个 HS256 校验引入额外依赖。
 */

export const SSO_COOKIE = "lixin_jw_sid";

/** 课表站的密钥派生参数（改动需与课表站同步） */
const SALT = "lixin-jw-session-v1";

let cachedKey: Buffer | null = null;
let cachedSecret: string | null = null;

function getKey(): Buffer | null {
  const secret = process.env.SSO_SECRET;
  if (!secret) return null;
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = crypto.scryptSync(secret, SALT, 32);
  cachedSecret = secret;
  return cachedKey;
}

/** 从 Cookie 头里取指定 cookie */
export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * 校验 JWT 并返回学号。
 * 返回 null 表示：未登录 / 签名不对 / 已过期 / 未配置密钥。
 */
export function verifySessionJwt(token: string | null): string | null {
  if (!token) return null;

  const key = getKey();
  if (!key) return null; // 未配置 SSO_SECRET，视为未登录（不报错，避免影响启动）

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  // 验签（恒定时间比较，防时序侧信道）
  const expected = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest();
  const actual = b64urlToBuf(sig);
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;

  // 解析载荷
  let payload: any;
  try {
    payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
  } catch {
    return null;
  }

  // 过期校验
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  // 算法白名单：防止 alg=none 之类的降级攻击
  try {
    const header = JSON.parse(b64urlToBuf(h).toString("utf8"));
    if (header.alg !== "HS256") return null;
  } catch {
    return null;
  }

  return typeof payload.sid === "string" && payload.sid ? payload.sid : null;
}

/** 从请求中取当前登录学号 */
export function currentStudentId(req: Request): string | null {
  return verifySessionJwt(readCookie(req, SSO_COOKIE));
}

/** 管理员学号（可配置，多个用逗号分隔） */
export function adminStudentIds(): string[] {
  return (process.env.ADMIN_STUDENT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdminStudent(studentId: string | null): boolean {
  if (!studentId) return false;
  return adminStudentIds().includes(studentId);
}
