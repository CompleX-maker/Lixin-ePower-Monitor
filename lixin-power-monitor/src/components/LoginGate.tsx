import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, LogIn, ShieldCheck, UserRound, ExternalLink, CheckCircle2 } from "lucide-react";

/** 课表站地址：登录入口在那里 */
const SCHEDULE_URL = "https://stellaura.tech";

/**
 * 登录门禁
 *
 * 本应用不自己做登录 —— 复用课表站（stellaura.tech）的会话（SSO）。
 *
 * 交互设计要点：
 *   - 用**新标签页**打开课表站，避免把本页顶掉（同标签跳转会导致「去了就回不来」）
 *   - 用户去登录期间，本页每 3 秒轮询一次登录状态，登录成功自动进入
 *   - 从别的标签切回来时立即重查，不用等轮询周期
 */
export function LoginGate({ children }: { children: ReactNode }) {
  // 点了「去登录」之后才开始轮询，平时不打扰后端
  const [waiting, setWaiting] = useState(false);

  const me = trpc.me.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchInterval: waiting ? 3_000 : false,
    refetchOnWindowFocus: true,
  });

  // 从课表站切回本页时立即重查，避免等待轮询
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
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!me.data?.loggedIn) {
    const openLogin = () => {
      // 新标签页打开，本页保持不动
      window.open(SCHEDULE_URL, "_blank", "noopener,noreferrer");
      setWaiting(true);
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl">电费监测站</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              登录后只能看到你自己绑定的宿舍
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2.5 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="flex items-start gap-1.5">
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  点下方按钮会<strong>新开一个标签页</strong>去课表站登录，本页不会丢
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

            <Button
              className="h-11 w-full text-base font-semibold"
              variant={waiting ? "outline" : "default"}
              onClick={openLogin}
            >
              <LogIn className="mr-2 h-4 w-4" />
              {waiting ? "再开一次登录页" : "新标签页去登录"}
            </Button>

            {waiting && (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-center">
                <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                  正在等待登录…
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  在新标签页登录完成后，切回本页即可自动进入
                </p>
              </div>
            )}

            <button
              className="flex w-full items-center justify-center gap-1 text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => void me.refetch()}
            >
              <CheckCircle2 className="h-3 w-3" />
              我已登录，立即刷新
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
