import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/** 公开接口：无需登录 */
export const publicQuery = t.procedure;

/**
 * 需要登录：从课表站的共享会话中取学号。
 * 未登录直接 401，前端据此显示登录引导。
 */
export const authedQuery = t.procedure.use(({ ctx, next }) => {
  if (!ctx.studentId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  return next({ ctx: { ...ctx, studentId: ctx.studentId } });
});

/** 仅管理员：全局配置类操作 */
export const adminQuery = t.procedure.use(({ ctx, next }) => {
  if (!ctx.studentId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  if (!ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可操作" });
  }
  return next({ ctx: { ...ctx, studentId: ctx.studentId } });
});
