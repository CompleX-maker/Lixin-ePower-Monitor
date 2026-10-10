import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  Zap, Wallet, CalendarClock, Activity, RefreshCw, Settings2, Bell, KeyRound, Radio,
  Plus, X, Mail, Building2, Pencil,
} from "lucide-react";
import VisitStatsPanel from "@/components/VisitStatsPanel";
import MyMailCard from "@/components/MyMailCard";
import Footer from "@/components/Footer";
import AdminPreviewToggle, { useIsAdmin } from "@/components/AdminPreviewToggle";

const TZ = "Asia/Shanghai";
const fmtTime = (ms: number, withDate = true) =>
  new Date(ms).toLocaleString("zh-CN", {
    timeZone: TZ,
    ...(withDate ? { month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
const fmtFull = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { timeZone: TZ, hour12: false });

type Settings = {
  username: string; hasPassword: boolean; threshold: number; pollMinutes: number;
  sctKey: string; hasSctKey: boolean;
  emailUser: string; emailTo: string; emailEnabled: boolean; hasEmailPass: boolean;
  accountErrors: Record<string, string>;
};

type DormItem = {
  id: number; name: string; sysid: number; areaid: number; buildid: number; roomid: string;
  roomLabel: string | null; emailTo: string | null; cardUser: string | null; hasCardPass: boolean;
  cardErr: string | null; createdAt: number;
};

function useCountdown(target: number | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return "--:--";
  const s = Math.max(0, Math.floor((target - now) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function Home() {
  const utils = trpc.useUtils();
  const dormsQ = trpc.monitor.dorms.useQuery(undefined, { refetchInterval: 60_000 });
  const dorms = useMemo(() => dormsQ.data ?? [], [dormsQ.data]);

  // 当前登录身份（来自课表站共享会话）。发件邮箱/号池这类全局配置只有管理员能看。
  // 走 useIsAdmin 而不是直接用 me.isAdmin：管理员可以关掉「管理员视角」，
  // 让整个界面按普通用户渲染，方便自查权限 UI 有没有漏隐藏。
  const { isAdmin } = useIsAdmin();

  // 待认领的宿舍（只对登录用户可见；认领后归到自己名下）
  const unclaimedQ = trpc.monitor.unclaimedDorms.useQuery(undefined, {
    refetchInterval: 120_000,
  });
  const unclaimed = useMemo(() => unclaimedQ.data ?? [], [unclaimedQ.data]);
  // 一个账号只能有一个宿舍：没有宿舍时才能添加/认领
  const canAddQ = trpc.monitor.canAddDorm.useQuery();
  const canAdd = canAddQ.data?.canAdd ?? false;
  const quotaReason = canAddQ.data?.reason ?? "一个账号只能绑定一个宿舍";

  const claimDorm = trpc.monitor.claimDorm.useMutation({
    onSuccess: () => {
      void utils.invalidate();
    },
    onError: (e) => window.alert(e.message),
  });
  const [selDorm, setSelDorm] = useState<number | null>(null);
  const dormId = dorms.find((d) => d.id === selDorm)?.id ?? dorms[0]?.id;
  const dorm = dorms.find((d) => d.id === dormId);

  const settingsQ = trpc.monitor.getSettings.useQuery();
  const threshold = settingsQ.data?.threshold ?? 10;
  const pollMinutes = settingsQ.data?.pollMinutes ?? 30;

  const qOpts = { refetchInterval: 60_000, enabled: dormId != null } as const;
  const current = trpc.monitor.current.useQuery({ dormId }, qOpts);
  const stats = trpc.monitor.stats.useQuery({ dormId }, qOpts);
  const recent = trpc.monitor.recent.useQuery({ limit: 12, dormId }, qOpts);
  const [hours, setHours] = useState(24);
  const history = trpc.monitor.history.useQuery({ hours, dormId }, qOpts);

  const [addOpen, setAddOpen] = useState(false);
  const [editDorm, setEditDorm] = useState<DormItem | null>(null);

  const refresh = trpc.monitor.refresh.useMutation({
    onSuccess: () => utils.monitor.invalidate(),
  });
  const removeDorm = trpc.monitor.removeDorm.useMutation({
    onSuccess: (_r, vars) => {
      if (selDorm === vars.id) setSelDorm(null);
      utils.monitor.invalidate();
    },
  });

  const last = current.data ?? null;
  const kwh = last?.ok ? last.elecKwh : null;
  const below = kwh != null && kwh < threshold;
  const nextPollAt = last ? last.fetchedAt + pollMinutes * 60_000 : null;
  const countdown = useCountdown(nextPollAt);

  const kwhColor =
    kwh == null ? "text-zinc-400" : below ? "text-red-400" : kwh < threshold * 2 ? "text-amber-300" : "text-emerald-400";

  const chartData = useMemo(
    () =>
      (history.data ?? []).map((r) => ({
        at: r.t,
        kwh: r.elec,
        label: fmtTime(r.t, hours > 24),
      })),
    [history.data, hours],
  );

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-5">
        {/* 顶栏 */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10">
              <Zap className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wide">电费监测站</h1>
              <p className="text-xs text-zinc-500">
                {dorm ? `${dorm.name}${dorm.roomLabel ? ` · ${dorm.roomLabel}` : ""}` : "加载中…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {settingsQ.data && !settingsQ.data.hasPassword ? (
              <Badge variant="destructive">未配置账号</Badge>
            ) : last && !last.ok ? (
              <Badge variant="destructive" title={last.errMsg ?? ""}>抓取失败</Badge>
            ) : below ? (
              <Badge variant="destructive" className="animate-pulse">电量告急</Badge>
            ) : (
              <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">监测中</Badge>
            )}
            <span className="text-xs text-zinc-500">下次抓取 {countdown}</span>
            <Button
              size="sm" variant="outline"
              className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        </header>

        {/* 管理员视角开关：仅真正的管理员可见，普通用户这里什么都不渲染 */}
        <AdminPreviewToggle />

        {/* 宿舍切换 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {dorms.map((d) => {
            const active = d.id === dormId;
            return (
              <div
                key={d.id}
                className={`flex shrink-0 items-center rounded-full border pl-4 pr-2 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                    : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <button className="mr-1.5 flex items-center whitespace-nowrap" onClick={() => setSelDorm(d.id)}>
                  {d.name}
                  {d.roomLabel ? <span className="ml-1 text-xs opacity-70">{d.roomLabel}</span> : null}
                  {d.emailTo && <Mail className="ml-1.5 h-3 w-3 opacity-60" />}
                  {d.cardUser && <Wallet className={`ml-1 h-3 w-3 ${d.cardErr ? "text-red-400 opacity-100" : "opacity-60"}`} />}
                </button>
                <button
                  className="rounded-full p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-amber-300"
                  title="编辑：备注名 / 专属邮箱 / 绑定一卡通"
                  onClick={() => setEditDorm(d)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {/* 每人最多一个宿舍，删除按钮必须常显，否则换不了宿舍 */}
                {(
                  <button
                    className="rounded-full p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                    title="删除该宿舍及其历史数据"
                    onClick={() => {
                      if (window.confirm(`确定删除「${d.name}」？其历史数据将一并清除。`)) {
                        removeDorm.mutate({ id: d.id });
                      }
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {canAdd && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 rounded-full border-dashed border-zinc-700 bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-amber-300"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 添加宿舍
            </Button>
          )}
          {!canAdd && (
            <span
              className="shrink-0 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-500"
              title={quotaReason}
            >
              一个账号仅限一个宿舍
            </span>
          )}
        </div>

        {/* 待认领宿舍：已经有数据、但还没绑定归属，登录用户可一键认领 */}
        {canAdd && unclaimed.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <span className="text-xs text-zinc-500">
              待认领 {unclaimed.length} 个：
            </span>
            {unclaimed.map((u) => (
              <button
                key={u.id}
                disabled={claimDorm.isPending}
                className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/5 px-2.5 py-1 text-xs text-amber-300 transition-colors hover:bg-amber-500/15 disabled:opacity-50"
                title="认领后只有你自己（和管理员）能看到这个宿舍"
                onClick={() => {
                  if (
                    window.confirm(
                      `确认「${u.roomLabel || u.name}」是你的宿舍？\n\n认领后归属会绑定到你的学号，只有你能看到。`,
                    )
                  ) {
                    claimDorm.mutate({ id: u.id });
                  }
                }}
              >
                <Plus className="h-3 w-3" />
                {u.roomLabel || u.name}
              </button>
            ))}
          </div>
        )}

        {/* 状态卡片 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Zap className="h-3.5 w-3.5" /> 剩余电量
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`font-mono text-4xl font-bold tabular-nums ${kwhColor}`}>
                {kwh == null ? "--.--" : kwh.toFixed(2)}
                <span className="ml-1 text-base font-normal text-zinc-500">度</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">阈值 {threshold} 度{below ? " · 已低于阈值" : ""}</p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Wallet className="h-3.5 w-3.5" /> 一卡通余额
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-4xl font-bold tabular-nums text-sky-300">
                {last?.ok ? (last.cardBalance != null ? last.cardBalance.toFixed(2) : "暂无") : "--.--"}
                {last?.ok && last.cardBalance != null && (
                  <span className="ml-1 text-base font-normal text-zinc-500">元</span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {dorm?.cardUser ? `绑定卡 ${dorm.cardUser} · 电控缴费从这里扣` : "未绑定一卡通（宿舍标签 ✎ 里绑）"}
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <CalendarClock className="h-3.5 w-3.5" /> 预计可用
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-4xl font-bold tabular-nums text-violet-300">
                {stats.data?.daysRemaining == null ? "--" : stats.data.daysRemaining}
                <span className="ml-1 text-base font-normal text-zinc-500">天</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">按 7 天日均 {stats.data?.dailyAvg ?? "--"} 度估算</p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Activity className="h-3.5 w-3.5" /> 近24h耗电
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-4xl font-bold tabular-nums text-orange-300">
                {stats.data?.usage24h ?? "--"}
                <span className="ml-1 text-base font-normal text-zinc-500">度</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {stats.data?.lastCharge
                  ? `最近充值 +${stats.data.lastCharge.amount}度 · ${fmtTime(stats.data.lastCharge.at)}`
                  : "7天内暂无充值记录"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 曲线 */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">电量变化曲线</CardTitle>
            <div className="flex gap-1">
              {[{ h: 24, t: "24小时" }, { h: 168, t: "7天" }, { h: 720, t: "30天" }].map(({ h, t }) => (
                <Button
                  key={h} size="sm" variant={hours === h ? "default" : "outline"}
                  className={hours === h ? "bg-amber-500 text-zinc-950 hover:bg-amber-400" : "border-zinc-700 bg-transparent text-zinc-400 hover:bg-zinc-800"}
                  onClick={() => setHours(h)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="h-72">
            {chartData.length < 2 ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                数据攒一攒就有了 —— 每 {pollMinutes} 分钟自动抓一次
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="kwh" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} minTickGap={40} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} domain={["auto", "auto"]} unit="度" />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                    labelStyle={{ color: "#a1a1aa" }}
                    formatter={(v: number | string) => [`${v} 度`, "剩余电量"]}
                    labelFormatter={(_, payload) => (payload?.[0] ? fmtFull(payload[0].payload.at) : "")}
                  />
                  <ReferenceLine y={threshold} stroke="#f87171" strokeDasharray="6 4" label={{ value: `阈值 ${threshold}`, fill: "#f87171", fontSize: 11 }} />
                  <Area type="monotone" dataKey="kwh" stroke="#fbbf24" strokeWidth={2} fill="url(#kwh)" connectNulls dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 最近记录 + 设置 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">最近抓取记录</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-500">时间</TableHead>
                    <TableHead className="text-right text-zinc-500">电量(度)</TableHead>
                    <TableHead className="text-right text-zinc-500">变化</TableHead>
                    <TableHead className="text-right text-zinc-500">余额(元)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recent.data ?? []).map((r, i, arr) => {
                    const prev = arr[i + 1];
                    const delta =
                      r.ok && r.elec != null && prev?.ok && prev.elec != null
                        ? Math.round((r.elec - prev.elec) * 100) / 100
                        : null;
                    return (
                      <TableRow key={r.id} className="border-zinc-800 hover:bg-zinc-800/40">
                        <TableCell className="font-mono text-xs text-zinc-400">{fmtFull(r.t)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {r.ok && r.elec != null ? r.elec.toFixed(2) : <span className="text-red-400" title={r.err ?? ""}>失败</span>}
                        </TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${delta == null ? "" : delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-zinc-500"}`}>
                          {delta == null ? "—" : delta > 0 ? `+${delta}` : delta}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-zinc-400">
                          {r.ok && r.card != null ? r.card.toFixed(2) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!recent.data || recent.data.length === 0) && (
                    <TableRow className="border-zinc-800">
                      <TableCell colSpan={4} className="text-center text-sm text-zinc-600">暂无记录</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {isAdmin ? (
            <SettingsCard
              settings={settingsQ.data}
              onSaved={() => {
                utils.monitor.invalidate();
                settingsQ.refetch();
              }}
            />
          ) : (
            /* 普通用户看不到发件邮箱 / SMTP 授权码 / 号池账号这些全局配置，
               只需要填一个「提醒发到哪个邮箱」 */
            <MyMailCard dorm={dorm} />
          )}
        </div>

        {/* 访客统计：仅管理员；组件内部对 403 也会静默不渲染 */}
        {isAdmin && <VisitStatsPanel />}

        <p className="pt-2 text-center text-xs text-zinc-600">
          数据源：ykt.lixin.edu.cn 一卡通服务平台 · 会话失效自动重登 · 账号密码仅存服务端
        </p>

        {/* GitHub 求 Star + 署名 + 备案 */}
        <Footer />
      </div>

      <AddDormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(id) => {
          setSelDorm(id);
          utils.monitor.invalidate();
        }}
      />
      <EditDormDialog
        dorm={editDorm}
        onClose={() => setEditDorm(null)}
        onSaved={() => utils.monitor.invalidate()}
      />
    </div>
  );
}

/* ---------------- 添加宿舍（级联选择） ---------------- */
type CascadeItem = { id: string; name: string };

function CascadeField({
  label, value, onChange, items, loading, disabled, placeholder,
}: {
  label: string; value: string | undefined; onChange: (v: string) => void;
  items: CascadeItem[] | undefined; loading: boolean; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-zinc-500">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
        <SelectTrigger className="border-zinc-700 bg-zinc-950">
          <SelectValue placeholder={loading ? "加载中…" : (placeholder ?? "请选择")} />
        </SelectTrigger>
        {/* position="popper" 必须保留：item-aligned 模式下长列表（房间有 400+ 项）
            会在滚动时不断把选中项拉回视野，表现为滚轮回弹到顶部 */}
        <SelectContent
          position="popper"
          sideOffset={4}
          className="border-zinc-700 bg-zinc-900 text-zinc-100 max-h-64"
        >
          {(items ?? []).map((it) => (
            <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
          ))}
          {items && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">无数据</div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function AddDormDialog({
  open, onOpenChange, onAdded,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; onAdded: (id: number) => void;
}) {
  const [sysId, setSysId] = useState<string>();
  const [areaId, setAreaId] = useState<string>();
  const [districtId, setDistrictId] = useState<string>();
  const [buildId, setBuildId] = useState<string>();
  const [floorId, setFloorId] = useState<string>();
  const [roomId, setRoomId] = useState<string>();
  const [name, setName] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const nameTouched = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);

  const num = (s?: string) => (s ? Number(s) : undefined);
  const qBase = { retry: false, refetchOnWindowFocus: false } as const;
  const systemsQ = trpc.monitor.cascade.useQuery({ level: "systems" }, { enabled: open, ...qBase });
  const areasQ = trpc.monitor.cascade.useQuery(
    { level: "areas", sysid: num(sysId) }, { enabled: open && !!sysId, ...qBase });
  const districtsQ = trpc.monitor.cascade.useQuery(
    { level: "districts", sysid: num(sysId), areaid: num(areaId) }, { enabled: open && !!areaId, ...qBase });
  const buildingsQ = trpc.monitor.cascade.useQuery(
    { level: "buildings", sysid: num(sysId), areaid: num(areaId), districtid: num(districtId) },
    { enabled: open && !!districtId, ...qBase });
  const floorsQ = trpc.monitor.cascade.useQuery(
    { level: "floors", sysid: num(sysId), areaid: num(areaId), districtid: num(districtId), buildid: num(buildId) },
    { enabled: open && !!buildId, ...qBase });
  const roomsQ = trpc.monitor.cascade.useQuery(
    { level: "rooms", sysid: num(sysId), areaid: num(areaId), districtid: num(districtId), buildid: num(buildId), floorid: num(floorId) },
    { enabled: open && !!floorId, ...qBase });

  const addDorm = trpc.monitor.addDorm.useMutation({
    onSuccess: (r) => {
      reset();
      onOpenChange(false);
      onAdded(r.id);
    },
    onError: (e) => setMsg(`添加失败：${e.message}`),
  });

  const reset = () => {
    setSysId(undefined); setAreaId(undefined); setDistrictId(undefined);
    setBuildId(undefined); setFloorId(undefined); setRoomId(undefined);
    setName(""); setEmailTo(""); nameTouched.current = false; setMsg(null);
  };

  const cascadeError =
    systemsQ.error ?? areasQ.error ?? districtsQ.error ?? buildingsQ.error ?? floorsQ.error ?? roomsQ.error;

  const roomName = roomsQ.data?.find((r) => r.id === roomId)?.name;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-amber-400" /> 添加宿舍
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            按学校电控系统的层级逐级选择。查询走你自己的一卡通账号，能查到的房间都可以加入监测。
          </p>
          <CascadeField label="电控系统" value={sysId} loading={systemsQ.isFetching}
            items={systemsQ.data}
            onChange={(v) => { setSysId(v); setAreaId(undefined); setDistrictId(undefined); setBuildId(undefined); setFloorId(undefined); setRoomId(undefined); }} />
          <CascadeField label="校区" value={areaId} loading={areasQ.isFetching} disabled={!sysId}
            items={areasQ.data}
            onChange={(v) => { setAreaId(v); setDistrictId(undefined); setBuildId(undefined); setFloorId(undefined); setRoomId(undefined); }} />
          <CascadeField label="区域" value={districtId} loading={districtsQ.isFetching} disabled={!areaId}
            items={districtsQ.data}
            onChange={(v) => { setDistrictId(v); setBuildId(undefined); setFloorId(undefined); setRoomId(undefined); }} />
          <CascadeField label="楼栋" value={buildId} loading={buildingsQ.isFetching} disabled={!districtId}
            items={buildingsQ.data}
            onChange={(v) => { setBuildId(v); setFloorId(undefined); setRoomId(undefined); }} />
          <CascadeField label="楼层" value={floorId} loading={floorsQ.isFetching} disabled={!buildId}
            items={floorsQ.data}
            onChange={(v) => { setFloorId(v); setRoomId(undefined); }} />
          <CascadeField label="房间" value={roomId} loading={roomsQ.isFetching} disabled={!floorId}
            items={roomsQ.data}
            onChange={(v) => {
              setRoomId(v);
              if (!nameTouched.current) {
                const rn = roomsQ.data?.find((r) => r.id === v)?.name;
                const bn = buildingsQ.data?.find((b) => b.id === buildId)?.name;
                if (rn) setName(bn ? `${bn} ${rn}` : rn);
              }
            }} />
          <div className="space-y-1">
            <Label className="text-xs text-zinc-500">备注名（展示用）</Label>
            <Input
              value={name}
              onChange={(e) => { nameTouched.current = true; setName(e.target.value); }}
              placeholder="例如：对门 6-521"
              className="border-zinc-700 bg-zinc-950"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-500">该宿舍专属通知邮箱（可选，多个用逗号隔开）</Label>
            <Input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="留空则只进全局汇总邮件"
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
          </div>
          {(cascadeError || msg) && (
            <p className="text-xs text-red-400">{msg ?? cascadeError?.message}</p>
          )}
          <Button
            className="w-full bg-amber-500 text-zinc-950 hover:bg-amber-400"
            disabled={!roomId || !name.trim() || addDorm.isPending}
            onClick={() =>
              addDorm.mutate({
                name: name.trim(),
                sysid: Number(sysId), areaid: Number(areaId),
                buildid: Number(buildId), roomid: roomId!, // 可能是 "3-1008" 这类字符串
                roomLabel: roomName,
                ...(emailTo.trim() ? { emailTo: emailTo.trim() } : {}),
              })
            }
          >
            {addDorm.isPending ? "添加中…" : "加入监测"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 设置卡片 ---------------- */
function SettingsCard({ settings, onSaved }: { settings: Settings | undefined; onSaved: () => void }) {
  const [threshold, setThreshold] = useState("");
  const [pollMinutes, setPollMinutes] = useState("");
  const [sendkey, setSendkey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [emailUser, setEmailUser] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [mailMsg, setMailMsg] = useState<string | null>(null);
  const emailInited = useRef(false);
  useEffect(() => {
    if (settings && !emailInited.current) {
      setEmailUser(settings.emailUser);
      setEmailTo(settings.emailTo);
      setEmailEnabled(settings.emailEnabled);
      emailInited.current = true;
    }
  }, [settings]);

  const updateAlert = trpc.monitor.updateAlert.useMutation({
    onSuccess: () => { setMsg("阈值/频率已保存"); onSaved(); },
    onError: (e) => setMsg(`保存失败：${e.message}`),
  });
  const updateCreds = trpc.monitor.updateCredentials.useMutation({
    onSuccess: (r) => {
      setMsg(r.ok ? "账密已保存，试抓取成功 ✅" : `账密已保存，但试抓取失败：${r.errMsg}`);
      setUsername(""); setPassword("");
      onSaved();
    },
    onError: (e) => setMsg(`保存失败：${e.message}`),
  });
  const updateSct = trpc.monitor.updateSct.useMutation({
    onSuccess: () => { setMsg("Server酱已保存"); onSaved(); },
    onError: (e) => setMsg(`保存失败：${e.message}`),
  });
  const testSct = trpc.monitor.testSct.useMutation({
    onSuccess: (r) => setMsg(r.ok ? "测试推送已发送，去微信看看" : `推送失败：${r.errMsg}`),
  });
  const updateEmail = trpc.monitor.updateEmail.useMutation({
    onSuccess: () => { setMailMsg("邮箱设置已保存"); setEmailPass(""); onSaved(); },
    onError: (e) => setMailMsg(`保存失败：${e.message}`),
  });
  const testEmail = trpc.monitor.testEmail.useMutation({
    onSuccess: (r) => setMailMsg(r.ok ? "测试邮件已发送，去收件箱看看（含垃圾箱）" : `发送失败：${r.errMsg}`),
    onError: (e) => setMailMsg(`发送失败：${e.message}`),
  });

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
          <Settings2 className="h-4 w-4" /> 监测设置
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 账密 */}
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <KeyRound className="h-3.5 w-3.5" /> 一卡通账号（号池主账号）
            {settings?.hasPassword && (
              <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
                已配置 {settings.username}
              </Badge>
            )}
          </div>
          {settings?.hasPassword && settings.accountErrors[settings.username] && (
            <p className="text-xs text-red-400">主账号登录失败：{settings.accountErrors[settings.username]}（号池会自动换用其他绑定账号抓电量）</p>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="学工号" value={username} onChange={(e) => setUsername(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
            <Input
              placeholder="统一身份认证密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
            <Button
              variant="outline" className="shrink-0 border-zinc-700 bg-transparent hover:bg-zinc-800"
              disabled={!username || !password || updateCreds.isPending}
              onClick={() => updateCreds.mutate({ username, password })}
            >
              {updateCreds.isPending ? "验证中…" : settings?.hasPassword ? "更新" : "保存"}
            </Button>
          </div>
        </div>

        {/* 阈值与频率 */}
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-zinc-500">
            报警阈值（度）
            <Input
              type="number" placeholder={String(settings?.threshold ?? 10)} value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            抓取间隔（分钟）
            <Input
              type="number" placeholder={String(settings?.pollMinutes ?? 30)} value={pollMinutes}
              onChange={(e) => setPollMinutes(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
          </label>
        </div>
        <Button
          variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800"
          disabled={updateAlert.isPending || (!threshold && !pollMinutes)}
          onClick={() =>
            updateAlert.mutate({
              threshold: parseFloat(threshold || String(settings?.threshold ?? 10)),
              pollMinutes: parseInt(pollMinutes || String(settings?.pollMinutes ?? 30), 10),
            })
          }
        >
          保存阈值/频率
        </Button>

        {/* QQ 邮箱 */}
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Mail className="h-3.5 w-3.5" /> QQ邮箱通知（每天 18:00 日报 + 低电量报警）
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              启用
              <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="发件QQ邮箱，如 123456@qq.com" value={emailUser}
              onChange={(e) => setEmailUser(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
            <Input
              placeholder={settings?.hasEmailPass ? "授权码已保存，留空不变" : "SMTP授权码（不是QQ密码）"}
              type="password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
          </div>
          <Input
            placeholder="收件邮箱（可与发件相同，多个用逗号隔开）" value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            className="border-zinc-700 bg-zinc-950 font-mono"
          />
          <p className="text-xs leading-relaxed text-zinc-600">
            授权码获取：网页登录 QQ邮箱 → 设置 → 账号与安全 → 安全设置 → POP3/SMTP服务 → 生成授权码。
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800"
              disabled={updateEmail.isPending || !emailUser || (!emailPass && !settings?.hasEmailPass) || !emailTo}
              onClick={() =>
                updateEmail.mutate({
                  emailUser, emailTo, enabled: emailEnabled,
                  ...(emailPass ? { emailPass } : {}),
                })
              }
            >
              保存邮箱设置
            </Button>
            <Button
              variant="outline" size="sm" className="border-zinc-700 bg-transparent hover:bg-zinc-800"
              disabled={testEmail.isPending || !settings?.hasEmailPass || !settings?.emailUser || !settings?.emailTo}
              onClick={() => testEmail.mutate()}
            >
              <Radio className="mr-1 h-3.5 w-3.5" /> {testEmail.isPending ? "发送中…" : "发送测试邮件"}
            </Button>
          </div>
          {mailMsg && <p className="text-xs text-amber-300">{mailMsg}</p>}
        </div>

        {/* Server酱 */}
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Bell className="h-3.5 w-3.5" /> 微信推送（Server酱 SendKey，可选）
            {settings?.hasSctKey && (
              <Badge className="bg-sky-500/15 text-sky-400 hover:bg-sky-500/15">已配置 {settings.sctKey}</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="留空保存则关闭推送" value={sendkey} onChange={(e) => setSendkey(e.target.value)}
              className="border-zinc-700 bg-zinc-950 font-mono"
            />
            <Button
              variant="outline" className="shrink-0 border-zinc-700 bg-transparent hover:bg-zinc-800"
              disabled={updateSct.isPending}
              onClick={() => updateSct.mutate({ sendkey })}
            >
              保存
            </Button>
            <Button
              variant="outline" className="shrink-0 border-zinc-700 bg-transparent hover:bg-zinc-800"
              disabled={!settings?.hasSctKey || testSct.isPending}
              onClick={() => testSct.mutate()}
            >
              <Radio className="mr-1 h-3.5 w-3.5" /> 测试
            </Button>
          </div>
        </div>

        {msg && <p className="text-xs text-amber-300">{msg}</p>}
      </CardContent>
    </Card>
  );
}

/* ---------------- 编辑宿舍（专属邮箱 / 绑定一卡通） ---------------- */
function EditDormDialog({
  dorm, onClose, onSaved,
}: {
  dorm: DormItem | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [cardUser, setCardUser] = useState("");
  const [cardPass, setCardPass] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (dorm) {
      setName(dorm.name);
      setEmailTo(dorm.emailTo ?? "");
      setCardUser(dorm.cardUser ?? "");
      setCardPass("");
      setMsg(null);
    }
  }, [dorm]);

  const update = trpc.monitor.updateDorm.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setMsg(`保存失败：${e.message}`),
  });

  const save = () => {
    if (!dorm) return;
    const u = cardUser.trim();
    update.mutate({
      id: dorm.id,
      name: name.trim() || dorm.name,
      emailTo: emailTo.trim(),
      cardUser: u,
      ...(u && cardPass ? { cardPass } : {}),
      ...(u && !cardPass && !dorm.hasCardPass ? {} : {}),
    });
  };

  return (
    <Dialog open={dorm != null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-amber-400" /> 编辑「{dorm?.name}」
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-zinc-500">备注名</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              className="border-zinc-700 bg-zinc-950" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-500">该宿舍专属通知邮箱（每天 18:00 单独发一封，多个用逗号隔开）</Label>
            <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
              placeholder="留空则只进全局汇总邮件"
              className="border-zinc-700 bg-zinc-950 font-mono" />
          </div>
          <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Wallet className="h-3.5 w-3.5" /> 绑定一卡通（查这个宿舍的余额；不绑则显示「暂无」）
              {dorm?.cardUser && (
                <Badge className="bg-sky-500/15 text-sky-400 hover:bg-sky-500/15">已绑定 {dorm.cardUser}</Badge>
              )}
            </div>
            {dorm?.cardErr && (
              <p className="text-xs text-red-400">该账号登录失败：{dorm.cardErr}，余额暂时取不到；电量会由号池其他账号代抓。</p>
            )}
            <div className="flex gap-2">
              <Input value={cardUser} onChange={(e) => setCardUser(e.target.value)}
                placeholder="学工号（清空 = 解绑）"
                className="border-zinc-700 bg-zinc-950 font-mono" />
              <Input value={cardPass} onChange={(e) => setCardPass(e.target.value)}
                type="password"
                placeholder={dorm?.hasCardPass ? "密码已保存，留空不变" : "统一身份认证密码"}
                className="border-zinc-700 bg-zinc-950 font-mono" />
            </div>
            <p className="text-xs leading-relaxed text-zinc-600">
              换绑新账号时密码必填；只改邮箱/备注名则密码留空即可。
            </p>
          </div>
          {msg && <p className="text-xs text-red-400">{msg}</p>}
          <Button
            className="w-full bg-amber-500 text-zinc-950 hover:bg-amber-400"
            disabled={update.isPending || (cardUser.trim() !== "" && cardUser.trim() !== (dorm?.cardUser ?? "") && !cardPass)}
            onClick={save}
          >
            {update.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
