import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

/**
 * 退出登录。
 *
 * ⚠️ 课表站与电费站共用同一个会话 cookie（Domain=.stellaura.tech），
 * 所以这里的「退出」会把两个站一起退掉。确认框里如实说明了这点，
 * 免得用户以为只退了电费站、回头发现课表站也要重新登录。
 */
export default function LogoutButton() {
  const utils = trpc.useUtils();

  const logout = trpc.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      // 整页重载最稳：顺带把内存里的查询缓存与倒计时一并清掉
      window.location.reload();
    },
    onError: (e) => window.alert(`退出失败：${e.message}`),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      className="border-zinc-700 bg-transparent text-zinc-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
      disabled={logout.isPending}
      onClick={() => {
        if (
          window.confirm(
            "确定退出登录？\n\n课表站和电费站共用同一个登录状态，退出后两个站都需要重新登录。",
          )
        ) {
          logout.mutate();
        }
      }}
    >
      <LogOut className="mr-1 h-3.5 w-3.5" />
      {logout.isPending ? "退出中…" : "退出"}
    </Button>
  );
}
