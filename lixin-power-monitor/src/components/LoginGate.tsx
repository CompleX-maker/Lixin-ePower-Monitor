import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Footer from "@/components/Footer";
import { SCHEDULE_LOGIN_URL, SCHEDULE_ORIGIN } from "@/const";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogIn,
  ShieldCheck,
  UserRound,
} from "lucide-react";

/**
 * 登录门禁。
 *
 * 本站没有独立账号体系：身份由课表站（stellaura.tech）签发，
 * 通过共享 cookie `lixin_jw_sid` 传递（Domain=.stellaura.tech）。
 * 所以这里的「登录」是跳去课表站完成统一身份认证，再自动跳回来。
 *
 * 跳转链接带 ?redirect=，课表站登录成功（或本来就已登录）后会自动
 * location.replace 回本页，不需要用户手动切回来。
 */
export function LoginGate({ children }: { children: ReactNode }) {
  // 用户点了登录、正在等对面的结果
  const [waiting, setWaiting] = useState(false);
  // 点了「立即刷新」但仍是未登录 —— 用于给出更明确的排查提示
  const [checkedNoResult, setCheckedNoResult] = useState(false);

  const me = trpc.me.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchInterval: waiting ? 3_000 : false,
    refetchOnWindowFocus: true,
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
    const goLogin = () => {
      // 新标签页打开，本页保持不动 —— 登录完成后对面会自己跳回来
      window.open(SCHEDULE_LOGIN_URL, "_blank", "noopener,noreferrer");
      setWaiting(true);
    };

    return (
      <div className="dark flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        {/* 顶部一层极淡的琥珀辉光，让深色页面不至于太死 */}
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
                <p className="mt-1 text-xs text-zinc-500">
                  登录后查看你宿舍的电费
                </p>
              </div>

              {/* 主登录入口 */}
              <Button
                className="h-11 w-full bg-amber-500 text-base font-semibold text-zinc-950 hover:bg-amber-400"
                onClick={goLogin}
              >
                <LogIn className="mr-2 h-4 w-4" />
                统一身份认证登录
              </Button>

              {/* 其他登录方式 */}
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-zinc-800" />
                <span className="text-[11px] text-zinc-600">其他登录方式</span>
                <span className="h-px flex-1 bg-zinc-800" />
              </div>

              <button
                type="button"
                onClick={goLogin}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                  <CalendarDays className="h-4 w-4 text-amber-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-zinc-200">立信课表</span>
                  <span className="block text-[11px] text-zinc-600">
                    已登录课表站则免登，直接跳回
                  </span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </button>

              {/* 说明 */}
              <div className="space-y-2 rounded-lg bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-500">
                <p className="flex items-start gap-1.5">
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    点上方入口会<strong className="text-zinc-400">新开一个标签页</strong>
                    去 {SCHEDULE_ORIGIN.replace("https://", "")} 登录，本页不会丢
                  </span>
                </p>
                <p className="flex items-start gap-1.5">
                  <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>每个人只能看到学号绑定到自己名下的宿舍</span>
                </p>
                <p className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>登录状态保留 30 天，两个站共用，不用重复登</span>
                </p>
              </div>

              {/* 等待中 */}
              {waiting && (
                <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                  <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-amber-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                    正在等待登录…
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

              {checkedNoResult && (
                <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-400/90">
                  还是没检测到登录。多半是浏览器里存着旧版会话（不含跨域属性）。
                  请点上面的入口去课表站<strong>重新登录一次</strong>，登录后会自动跳回本页。
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

export default LoginGate;
