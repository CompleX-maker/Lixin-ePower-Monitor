import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail } from "lucide-react";

type Dorm = {
  id: number;
  name: string;
  roomLabel: string | null;
  emailTo: string | null;
};

/**
 * 普通用户的「我的接收邮箱」。
 *
 * 发件用的 QQ 邮箱与 SMTP 授权码是全局配置，只有管理员能看能改；
 * 普通用户不需要关心，只要告诉系统「提醒发到哪个邮箱」就行。
 */
export default function MyMailCard({ dorm }: { dorm: Dorm | undefined }) {
  const utils = trpc.useUtils();
  const saved = dorm?.emailTo ?? "";

  const [email, setEmail] = useState(saved);
  const [lastSynced, setLastSynced] = useState(saved);
  const [msg, setMsg] = useState("");

  // 宿舍数据刷新后同步一次草稿。
  // 用 React 官方的「渲染期间调整 state」写法，而不是 useEffect ——
  // 在 effect 里同步 setState 会触发级联渲染（eslint 的
  // react-hooks/set-state-in-effect 就是拦这个）。
  // 只在远端值真的变了时才覆盖，所以不会打断用户正在输入的内容。
  if (saved !== lastSynced) {
    setLastSynced(saved);
    setEmail(saved);
  }

  const save = trpc.monitor.updateDorm.useMutation({
    onSuccess: () => {
      setMsg("已保存");
      void utils.monitor.invalidate();
      setTimeout(() => setMsg(""), 2500);
    },
    onError: (e) => setMsg(e.message),
  });

  if (!dorm) return null;

  const dirty = email.trim() !== saved.trim();

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
          <Mail className="h-4 w-4" /> 我的接收邮箱
          {saved && (
            <Badge className="ml-1 bg-emerald-500/15 text-[10px] text-emerald-400 hover:bg-emerald-500/15">
              已设置
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-zinc-500">
          低电量报警和每天 18:00 的电费日报会发到这个邮箱。
          {dorm.roomLabel ? (
            <>
              （对应宿舍 <span className="font-mono text-zinc-400">{dorm.roomLabel}</span>）
            </>
          ) : null}
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="你的邮箱，如 123456@qq.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-zinc-700 bg-zinc-950 font-mono"
          />
          <Button
            size="sm"
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate({ id: dorm.id, emailTo: email.trim() })}
          >
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>

        {saved && (
          <button
            className="text-[11px] text-zinc-600 underline underline-offset-2 hover:text-zinc-400"
            onClick={() => {
              setEmail("");
              save.mutate({ id: dorm.id, emailTo: "" });
            }}
          >
            不再接收邮件提醒
          </button>
        )}

        {msg && <p className="text-xs text-amber-300">{msg}</p>}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          发件邮箱由管理员统一配置，你只需要填自己的收件地址。多个邮箱用逗号隔开。
        </p>
      </CardContent>
    </Card>
  );
}
