import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { currentSessionInfo, currentStudentId, isAdminStudent } from "./lib/sso";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** 当前登录学号（来自课表站的共享会话，未登录为 null） */
  studentId: string | null;
  /** 当前登录者姓名（课表站顺手签发；老会话可能为 null） */
  studentName: string | null;
  /** 是否管理员 */
  isAdmin: boolean;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const session = currentSessionInfo(opts.req);
  const studentId = currentStudentId(opts.req);
  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    studentId,
    /** 当前登录者姓名（来自课表站共享会话；老会话可能为 null） */
    studentName: session?.name ?? null,
    isAdmin: isAdminStudent(studentId),
  };
}
