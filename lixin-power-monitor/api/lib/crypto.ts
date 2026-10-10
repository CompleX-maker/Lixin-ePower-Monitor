import crypto from "node:crypto";

/**
 * 敏感字段的静态加密（AES-256-GCM）
 *
 * 密钥由 APP_SECRET 经 scrypt 派生，不额外引入环境变量。
 *
 * 密文格式：`v1.<iv>.<tag>.<ciphertext>`
 *   - 带 `v1.` 前缀，用于区分「已加密」与「历史明文」
 *   - 解密时若不带前缀，按明文原样返回（向后兼容，便于平滑迁移）
 *
 * 与课表项目（lixin-schedule）采用同一套方案：
 *   scrypt 派生 → 密钥分离 → AES-256-GCM（认证加密）→ IV 每次随机
 */

const PREFIX = "v1.";
const SALT = "lixin-epower-v1";

let cachedKey: Buffer | null = null;
let cachedSecret: string | null = null;

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET missing");
  // 同一进程内缓存，避免每次加解密都跑一遍 scrypt
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = crypto.scryptSync(secret, SALT, 32);
  cachedSecret = secret;
  return cachedKey;
}

/** 加密；空值原样返回（null / "" 不加密） */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return plain ?? null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX + iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

/**
 * 解密。
 *   - 不带 v1. 前缀 → 视为历史明文，原样返回
 *   - 解密失败（密钥变更/数据损坏）→ 返回 null，不让整个请求崩掉
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (payload === null || payload === undefined || payload === "") return payload ?? null;
  if (!payload.startsWith(PREFIX)) return payload; // 历史明文

  try {
    const parts = payload.slice(PREFIX.length).split(".");
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const ct = Buffer.from(ctB64, "base64url");

    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    console.error("[crypto] 解密失败（密钥可能已更换）:", (e as Error).message);
    return null;
  }
}

/** 是否已加密（用于迁移脚本判断） */
export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}
