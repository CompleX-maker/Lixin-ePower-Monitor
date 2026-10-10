import { Github, Star } from "lucide-react";
import {
  AUTHOR,
  GITHUB_URL,
  ICP_LICENSE,
  ICP_URL,
  POLICE_LICENSE,
  POLICE_URL,
} from "@/const";

/**
 * 页脚：GitHub 入口 + 署名 + 备案信息。
 *
 * 备案号是法规要求必须展示的，且必须可点击跳转到官方查询平台。
 * 未配置的备案号不会渲染（见 src/const.ts）。
 */
export default function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`flex flex-col items-center justify-center gap-1.5 text-zinc-600 ${
        compact ? "py-3 text-[11px]" : "py-4 text-xs"
      }`}
    >
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        <Github className="h-3.5 w-3.5" />
        <span>开源项目</span>
        <span className="inline-flex items-center gap-0.5 text-amber-400">
          <Star className="h-3 w-3" />
          求个 Star
        </span>
      </a>

      <span className="text-[11px] opacity-70">Designed by {AUTHOR}</span>

      {(ICP_LICENSE || POLICE_LICENSE) && (
        <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] opacity-70">
          {ICP_LICENSE && (
            <a
              href={ICP_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-opacity hover:opacity-100 hover:underline"
            >
              {ICP_LICENSE}
            </a>
          )}
          {ICP_LICENSE && POLICE_LICENSE && <span className="opacity-40">·</span>}
          {POLICE_LICENSE && (
            <a
              href={POLICE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-opacity hover:opacity-100 hover:underline"
            >
              {POLICE_LICENSE}
            </a>
          )}
        </div>
      )}
    </footer>
  );
}
