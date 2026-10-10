import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Eye, Users } from "lucide-react";

const TZ = "Asia/Shanghai";
const fmt = (ms: number) =>
  new Date(Number(ms)).toLocaleString("zh-CN", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * 访客统计（仅管理员可见）。
 * 数据来自 visit_logs：用户打开网页时写入，同一学号 5 分钟内只记一次。
 * 只保存学号与姓名，不记录 IP 与设备信息。
 */
export default function VisitStatsPanel() {
  const [tab, setTab] = useState<"people" | "recent">("people");
  const q = trpc.monitor.visitStats.useQuery(undefined, { refetchInterval: 60_000 });

  if (q.isLoading) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">访客统计</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-xs text-zinc-600">加载中…</p>
        </CardContent>
      </Card>
    );
  }

  // 非管理员拿不到数据（403），静默不渲染
  if (q.error || !q.data) return null;

  const { overview, periods, users, recent } = q.data;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
          <Eye className="h-4 w-4" /> 访客统计
          <Badge className="ml-1 bg-amber-500/15 text-[10px] text-amber-300 hover:bg-amber-500/15">
            仅管理员
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 总体 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-zinc-800 p-2">
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Users className="h-3 w-3" /> 累计访客
            </div>
            <div className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-100">
              {overview.users}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 p-2">
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Eye className="h-3 w-3" /> 累计访问次数
            </div>
            <div className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-100">
              {overview.visits}
            </div>
          </div>
        </div>

        {/* 时间维度 */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["今日", periods.today],
              ["近 7 天", periods.week],
              ["近 30 天", periods.month],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border border-zinc-800 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-500">
                <CalendarDays className="h-3 w-3" />
                {label}
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-zinc-200">
                {v.users}
                <span className="text-xs font-normal text-zinc-500"> 人</span>
              </div>
              <div className="font-mono text-[11px] tabular-nums text-zinc-500">{v.visits} 次</div>
            </div>
          ))}
        </div>

        {/* 切换名单 / 流水 */}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={tab === "people" ? "default" : "outline"}
            className={`h-7 flex-1 px-2 text-xs ${tab === "people" ? "" : "border-zinc-700 bg-transparent hover:bg-zinc-800"}`}
            onClick={() => setTab("people")}
          >
            访问名单（{users.length}）
          </Button>
          <Button
            size="sm"
            variant={tab === "recent" ? "default" : "outline"}
            className={`h-7 flex-1 px-2 text-xs ${tab === "recent" ? "" : "border-zinc-700 bg-transparent hover:bg-zinc-800"}`}
            onClick={() => setTab("recent")}
          >
            最近流水（{recent.length}）
          </Button>
        </div>

        {tab === "people" ? (
          <div className="max-h-72 overflow-y-auto">
            {users.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-600">暂无访问记录</p>
            ) : (
              <ul className="space-y-1.5">
                {users.map((u) => (
                  <li
                    key={u.studentId}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-zinc-200">
                          {u.realName || "（未知姓名）"}
                        </span>
                        <span className="shrink-0 font-mono text-zinc-500">{u.studentId}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-zinc-600">
                        首次 {fmt(u.firstVisit)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[11px]">
                        {u.visits} 次
                      </Badge>
                      <div className="mt-1 font-mono text-[10px] text-zinc-600">
                        {fmt(u.lastVisit)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-600">暂无访问记录</p>
            ) : (
              <ul className="space-y-0">
                {recent.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center gap-2 border-b border-dashed border-zinc-800 px-1 py-1.5 text-xs last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-300">
                      {v.realName || "（未知）"}
                      <span className="ml-1.5 font-mono text-zinc-500">{v.studentId}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                      {fmt(v.visitedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          说明：访问记录在用户打开网页时写入，同一学号 5 分钟内只记一次。仅保存学号与姓名，
          <span className="text-zinc-500">不记录 IP 与设备信息</span>。
        </p>
      </CardContent>
    </Card>
  );
}
