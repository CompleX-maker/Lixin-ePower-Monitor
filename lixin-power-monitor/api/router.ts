import { createRouter, publicQuery } from "./middleware";
import { monitorRouter } from "./monitorRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  /**
   * 当前登录状态。
   * 登录信息来自课表站共享的会话 cookie（SSO），本应用不做自己的登录。
   */
  me: publicQuery.query(({ ctx }) => ({
    loggedIn: Boolean(ctx.studentId),
    studentId: ctx.studentId,
    isAdmin: ctx.isAdmin,
  })),

  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;
