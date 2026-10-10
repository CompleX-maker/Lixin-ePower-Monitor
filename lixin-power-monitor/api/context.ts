import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { currentStudentId, isAdminStudent } from "./lib/sso";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** 当前登录学号（来自课表站的共享会话，未登录为 null） */
  studentId: string | null;
  /** 是否管理员 */
  isAdmin: boolean;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const studentId = currentStudentId(opts.req);
  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    studentId,
    isAdmin: isAdminStudent(studentId),
  };
}
