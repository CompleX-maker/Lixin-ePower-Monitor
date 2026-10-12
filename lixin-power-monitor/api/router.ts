import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { monitorRouter } from "./monitorRouter";
import { recordVisit } from "./queries/visits";
import { serialize } from "hono/utils/cookie";
import { SSO_COOKIE, sessionCookieOptions } from "./lib/cookies";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  ownCookieOptions,
  signSession,
} from "./lib/session";
import { verifyCredentials } from "./scraper";


/* ---------------- 登录限流 ----------------
   账密核验是打向学校统一身份认证的真实登录请求。不加限制的话，
   一个脚本就能拿本站当爆破跳板，而且真的可能导致同学账号被锁。
   这里按学号做内存计数：10 分钟内最多 5 次失败。 */
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;
const loginFails = new Map<string, { n: number; at: number }>();

function loginRateOk(studentId: string): boolean {
  const rec = loginFails.get(studentId);
  if (!rec) return true;
  if (Date.now() - rec.at > LOGIN_WINDOW_MS) {
    loginFails.delete(studentId);
    return true;
  }
  return rec.n < LOGIN_MAX_FAILS;
}

function noteLoginFail(studentId: string) {
  const rec = loginFails.get(studentId);
  if (!rec || Date.now() - rec.at > LOGIN_WINDOW_MS) {
    loginFails.set(studentId, { n: 1, at: Date.now() });
  } else {
    rec.n += 1;
  }
}

export const appRouter = createRouter({
  /**
   * 统一身份认证登录（在本站直接输学号密码）。
   *
   * 由本站拿着账密去学校 CAS 核验一次，**核验完即丢，绝不保存密码**
   * （抓宿舍读数用的是号池里的公共账号，跟登录者本人无关）。
   * 核验通过后签发本站自己的会话 cookie `epower_sid`（主机专属）。
   *
   * 另一条路是从课表站带着共享会话跳过来，两条路并存，见 lib/session.ts。
   */
  login: publicQuery
    .input(
      z.object({
        studentId: z.string().min(4).max(64),
        password: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const sid = input.studentId.trim();
      if (!loginRateOk(sid)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "尝试次数过多，请 10 分钟后再试",
        });
      }

      let profile;
      try {
        profile = await verifyCredentials(sid, input.password);
      } catch {
        noteLoginFail(sid);
        // 不区分「学号不存在」与「密码错误」，避免被用来探测学号
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "学号或密码不正确（也可能是统一身份认证暂时不可用）",
        });
      }

      loginFails.delete(sid);
      const token = signSession(sid, profile.name);
      const opts = ownCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        serialize(SESSION_COOKIE, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
          secure: opts.secure,
          maxAge: SESSION_MAX_AGE_S,
        }),
      );
      return { ok: true as const, name: profile.name, studentId: profile.studentId ?? sid };
    }),

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
    const setCookie = (name: string, opts: ReturnType<typeof ownCookieOptions>, domain?: string) => {
      ctx.resHeaders.append(
        "set-cookie",
        serialize(name, "", {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
          secure: opts.secure,
          maxAge: 0, // 立刻过期 = 删除
          ...(domain ? { domain } : {}),
        }),
      );
    };

    // 本站自己的会话（主机专属）
    setCookie(SESSION_COOKIE, ownCookieOptions(ctx.req.headers));

    // 课表站的共享会话 —— **两种都要清**。
    // 浏览器按 name+domain+path 存 cookie，而课表站历史上签发过带 Domain 的
    // 和不带 Domain（主机专属）两种，同名同路径会同时发出，读到哪个不确定。
    // 只清一种，用户就会「点了退出还登着」，甚至切换成另一个账号。
    const shared = sessionCookieOptions(ctx.req.headers);
    setCookie(SSO_COOKIE, shared, shared.domain); // 带 Domain 的那条
    setCookie(SSO_COOKIE, shared); // 主机专属的那条

    return { ok: true as const };
  }),

  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;
