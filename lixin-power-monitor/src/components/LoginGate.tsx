import type { ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, LogIn, ShieldCheck, UserRound } from "lucide-react";

/** 课表站地址：登录入口在那里 */
const SCHEDULE_URL = "https://stellaura.tech";

/**
 * 登录门禁
 *
 * 本应用不自己做登录 —— 复用课表站（stellaura.tech）的会话（SSO）。
 * 未登录时给出去那边登录的引导，登录后回到本页即可看到自己的宿舍。
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const me = trpc.me.useQuery(undefined, { retry: false, staleTime: 30_000 });

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!me.data?.loggedIn) {
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
                <LogIn className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  本站与课表共用登录。点击下方按钮到课表站登录，回来刷新即可
                </span>
              </p>
              <p className="flex items-start gap-1.5">
                <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>每个人只能看到学号绑定到自己名下的宿舍</span>
              </p>
              <p className="flex items-start gap-1.5">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>登录状态保留 30 天，不用每次都登</span>
              </p>
            </div>

            <Button
              className="h-11 w-full text-base font-semibold"
              onClick={() => {
                window.location.href = SCHEDULE_URL;
              }}
            >
              <LogIn className="mr-2 h-4 w-4" />
              去登录
            </Button>

            <button
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => void me.refetch()}
            >
              我已在课表登录，刷新试试
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
