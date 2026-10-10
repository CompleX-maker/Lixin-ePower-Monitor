import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { isAdminStudent } from "./lib/sso";
import { currentSession } from "./lib/session";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** 当前登录学号（本站会话或课表站共享会话，未登录为 null） */
  studentId: string | null;
  /** 当前登录者姓名（课表站顺手签发；老会话可能为 null） */
  studentName: string | null;
  /** 是否管理员 */
  isAdmin: boolean;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  // 先看本站自己的会话（登录页直接输账密），再看课表站的共享会话（SSO）
  const session = currentSession(opts.req);
  const studentId = session?.studentId ?? null;
  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    studentId,
    /** 当前登录者姓名（来自课表站共享会话；老会话可能为 null） */
    studentName: session?.name ?? null,
    isAdmin: isAdminStudent(studentId),
  };
}
