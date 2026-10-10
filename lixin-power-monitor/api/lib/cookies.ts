import type { CookieOptions } from "hono/utils/cookie";
import { SSO_COOKIE } from "./sso";

export { SSO_COOKIE };

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

/**
 * 清除共享会话 cookie 时要用到的属性。
 *
 * ⚠️ 关键点：浏览器是按 **name + domain + path** 三元组匹配 cookie 的。
 * 课表站签发 `lixin_jw_sid` 时带了 `Domain=.stellaura.tech`（见课表站
 * `COOKIE_DOMAIN`），所以本站要删掉它，**必须带上完全相同的 Domain**，
 * 否则只会去删一个根本不存在的主机专属 cookie，用户看起来就是「点了退出没反应」。
 *
 * Domain 的来源，按优先级：
 *   1. 环境变量 `COOKIE_DOMAIN`（与课表站同名同值，显式配置最稳妥）
 *   2. 从请求的 Host 推：去掉最前面一段（epower.stellaura.tech → .stellaura.tech）
 *      只对至少三段的主机名生效，`127.0.0.1` 这类不会误推
 */
export function sessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);

  let domain = process.env.COOKIE_DOMAIN?.trim() || "";
  if (!domain && !localhost) {
    const host = (headers.get("host") || "").split(":")[0];
    const parts = host.split(".");
    if (parts.length >= 3) domain = "." + parts.slice(-2).join(".");
  }

  return {
    httpOnly: true,
    path: "/",
    // SameSite=None 必须搭配 Secure，所以只在非 localhost 下启用
    sameSite: localhost ? "Lax" : "None",
    secure: !localhost,
    ...(domain && !localhost ? { domain } : {}),
  };
}
