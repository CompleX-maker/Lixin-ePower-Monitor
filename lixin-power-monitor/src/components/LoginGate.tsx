import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Footer from "@/components/Footer";
import { SCHEDULE_LOGIN_URL } from "@/const";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  ShieldCheck,
  UserRound,
} from "lucide-react";

/**
 * 登录门禁。
 *
 * 两条登录路径并存（后端见 api/lib/session.ts）：
 *   1. 本站直接登录：输学号密码，由本站向学校统一身份认证核验一次，
 *      核验完即丢、不保存密码，然后签发本站自己的会话 cookie。
 *   2. 从课表站带共享会话跳过来（SSO）：课表站已登录则免登。
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();

  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState("");

  // SSO：点了「立信课表」、正在等对面登录完
  const [waiting, setWaiting] = useState(false);
  // 点了「立即刷新」但仍是未登录
  const [checkedNoResult, setCheckedNoResult] = useState(false);

  const me = trpc.me.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchInterval: waiting ? 3_000 : false,
    refetchOnWindowFocus: true,
  });

  const login = trpc.login.useMutation({
    onSuccess: async () => {
      setPassword("");
      await utils.invalidate();
    },
    onError: (e) => setErr(e.message),
  });

  // 从课表站切回本页时立即重查，避免干等轮询
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void me.refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [me]);

  if (me.isLoading) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (!me.data?.loggedIn) {
    const goSchedule = () => {
      window.open(SCHEDULE_LOGIN_URL, "_blank", "noopener,noreferrer");
      setWaiting(true);
    };

    const canSubmit = studentId.trim().length >= 4 && password.length > 0 && !login.isPending;

    const submit = () => {
      if (!canSubmit) return;
      setErr("");
      login.mutate({ studentId: studentId.trim(), password });
    };

    return (
      <div className="dark flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.10),transparent_65%)]"
        />

        <div className="relative flex flex-1 items-center justify-center px-6 py-10">
          <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900/60">
            <CardContent className="space-y-5 pt-7">
              {/* Logo + 标题 */}
              <div className="flex flex-col items-center text-center">
                <img
                  src="/static/icons/icon.svg"
                  alt="立信电费监测站"
                  className="h-16 w-16 rounded-2xl shadow-lg shadow-amber-500/10"
                />
                <h1 className="mt-3 text-xl font-bold tracking-wide">立信电费监测站</h1>
                <p className="mt-1 text-xs text-zinc-500">登录后查看你宿舍的电费</p>
              </div>

              {/* 主登录：本站直接登录 */}
              <form
                className="space-y-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Input
                  placeholder="学号"
                  value={studentId}
                  inputMode="numeric"
                  autoComplete="username"
                  onChange={(e) => {
                    setStudentId(e.target.value);
                    setErr("");
                  }}
                  className="border-zinc-700 bg-zinc-950"
                />
                <div className="relative">
                  <Input
                    placeholder="统一身份认证密码"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErr("");
                    }}
                    className="border-zinc-700 bg-zinc-950 pr-10"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={showPwd ? "隐藏密码" : "显示密码"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                    onClick={() => setShowPwd((v) => !v)}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <Button
                  type="submit"
                  className="h-11 w-full bg-amber-500 text-base font-semibold text-zinc-950 hover:bg-amber-400"
                  disabled={!canSubmit}
                >
                  {login.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在核验…
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-4 w-4" />
                      统一身份认证登录
                    </>
                  )}
                </Button>
              </form>

              {err && (
                <p className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-400">
                  {err}
                </p>
              )}

              {/* 其他登录方式 */}
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-zinc-800" />
                <span className="text-[11px] text-zinc-600">其他登录方式</span>
                <span className="h-px flex-1 bg-zinc-800" />
              </div>

              <button
                type="button"
                onClick={goSchedule}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                  <CalendarDays className="h-4 w-4 text-amber-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-zinc-200">用立信课表账号登录</span>
                  <span className="block text-[11px] text-zinc-600">
                    已登录课表站则免登，自动跳回
                  </span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </button>

              {/* 说明 */}
              <div className="space-y-2 rounded-lg bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-500">
                <p className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    密码仅用于本次向学校统一身份认证核验，<strong className="text-zinc-400">核验完即丢</strong>，
                    本站不保存
                  </span>
                </p>
                <p className="flex items-start gap-1.5">
                  <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>每个人只能看到学号绑定到自己名下的宿舍</span>
                </p>
                <p className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>登录状态保留 30 天，不用反复登</span>
                </p>
              </div>

              {/* SSO 等待中 */}
              {waiting && (
                <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                  <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-amber-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                    正在等待课表站登录…
                  </p>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    在新标签页登录完成后会自动跳回来，也可以直接切回本页
                  </p>
                </div>
              )}

              <button
                className="flex w-full items-center justify-center gap-1 text-center text-xs text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300 disabled:opacity-60"
                disabled={me.isFetching}
                onClick={async () => {
                  const r = await me.refetch();
                  if (!r.data?.loggedIn) setCheckedNoResult(true);
                }}
              >
                <CheckCircle2 className={`h-3 w-3 ${me.isFetching ? "animate-spin" : ""}`} />
                {me.isFetching ? "检查中…" : "我已登录，立即刷新"}
              </button>

              {checkedNoResult && !waiting && (
                <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-400/90">
                  没检测到登录。如果用课表站登录过，多半是浏览器里存着旧版会话
                  （不含跨域属性），去课表站<strong>重新登录一次</strong>即可。
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Footer />
      </div>
    );
  }

  return <>{children}</>;
}

// App.tsx 用的是具名导入，这里两个都导出，避免再来一次构建失败
export default LoginGate;
