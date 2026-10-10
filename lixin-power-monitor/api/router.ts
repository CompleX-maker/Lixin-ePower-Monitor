import { createRouter, publicQuery } from "./middleware";
import { monitorRouter } from "./monitorRouter";
import { recordVisit } from "./queries/visits";

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

  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;
