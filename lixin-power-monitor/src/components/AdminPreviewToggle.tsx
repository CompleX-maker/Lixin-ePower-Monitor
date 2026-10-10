import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  effectiveIsAdmin,
  isPreviewingAsUser,
  setPreviewAsUser,
  subscribePreview,
} from "@/lib/admin-preview";

/** 订阅预览状态，并返回「界面上应使用的管理员判断」 */
export function useIsAdmin() {
  const me = trpc.me.useQuery(undefined, { retry: false });
  const [previewing, setPreviewing] = useState(() => isPreviewingAsUser());

  useEffect(() => subscribePreview(() => setPreviewing(isPreviewingAsUser())), []);

  const realIsAdmin = me.data?.isAdmin ?? false;
  return {
    /** 是否真的拥有管理员权限（与预览无关） */
    realIsAdmin,
    /** 界面上应使用的判断：预览开启时为 false */
    isAdmin: effectiveIsAdmin(realIsAdmin),
    previewing,
    isLoaded: me.isFetched,
  };
}

/**
 * 管理员视角开关（仅真正的管理员可见）
 *
 * 关掉后整个界面按普通用户呈现，方便确认权限相关的 UI 是否正确隐藏。
 *
 * 开关尺寸（务必对齐，否则滑块会歪）：
 *   轨道  h-6 w-11 = 24 × 44 px，内边距 2px
 *   滑块  h-5 w-5  = 20 × 20 px
 *   关闭时 left=2px，开启时 left = 44 - 2 - 20 = 22px
 *   因此统一用 `left-0.5` 起始 + translate 位移，避免 top/left 混用导致错位
 */
export default function AdminPreviewToggle() {
  const { realIsAdmin, previewing } = useIsAdmin();

  // 非管理员完全不显示，避免普通用户看到「管理员」字样产生困惑
  if (!realIsAdmin) return null;

  const on = !previewing; // 开关「开」= 以管理员视图显示

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            {on ? (
              <Eye className="h-3.5 w-3.5 text-zinc-400" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-amber-400" />
            )}
            管理员视角
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">
            {on
              ? "当前为管理员视图，可见号池账号、发件邮箱、访问统计等管理功能"
              : "当前按普通用户视图显示，管理功能已隐藏"}
          </p>
        </div>

        {/* 开关：轨道 44×24，滑块 20×20，用 left-0.5 + translate-x 保证居中 */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="管理员视角开关"
          onClick={() => setPreviewAsUser(!previewing)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            on ? "bg-amber-500" : "bg-zinc-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
              on ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {!on && (
        <p className="mt-2 flex items-start gap-1 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-400/90">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            你仍然是管理员，只是界面按普通用户显示。重新打开开关即可恢复管理功能。
          </span>
        </p>
      )}
    </section>
  );
}
