import { createRouter, publicQuery } from "./middleware";
import { monitorRouter } from "./monitorRouter";
import { recordVisit } from "./queries/visits";
import { serialize } from "hono/utils/cookie";
import { SSO_COOKIE, sessionCookieOptions } from "./lib/cookies";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  /**
   * 当前登录状态。
   * 登录信息来自课表站共享的会话 cookie（SSO），本应用不做自己的登录。
   */
  me: publicQuery.query(async ({ ctx }) => {
    // 顺手记一次访问（5 分钟内去重；统计失败绝不阻断登录判断）
    if (ctx.studentId) {
      try {
        await recordVisit({ studentId: ctx.studentId, realName: ctx.studentName });
      } catch {
        /* 忽略 */
      }
    }
    return {
      loggedIn: Boolean(ctx.studentId),
      studentId: ctx.studentId,
      name: ctx.studentName,
      isAdmin: ctx.isAdmin,
    };
  }),

  /**
   * 退出登录。
   *
   * 本站没有自己的会话，身份存在课表站签发的共享 cookie 里
   * （Domain=.stellaura.tech），所以这里是把那个 cookie 删掉 ——
   * **课表站会一并退出**，前端需要如实告诉用户。
   *
   * 用 publicQuery 而不是 authedQuery：即便 cookie 已经失效/过期，
   * 也应该能正常走完退出流程，不该报 401。
   */
  logout: publicQuery.mutation(({ ctx }) => {
    const opts = sessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      serialize(SSO_COOKIE, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0, // 立刻过期 = 删除
        ...(opts.domain ? { domain: opts.domain } : {}),
      }),
    );
    return { ok: true as const };
  }),

  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;
