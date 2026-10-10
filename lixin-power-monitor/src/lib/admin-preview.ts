/**
 * 管理员「以普通用户身份预览」开关的状态管理。
 *
 * 为什么需要它：光看代码很难确认权限相关的 UI 是不是真的对普通用户隐藏了。
 * 关掉开关后整个界面按普通用户渲染，管理员能亲眼看到对方的样子。
 *
 * 状态存在 localStorage 里，刷新后保持；并通过 storage 事件跨标签页同步。
 */

const KEY = "epower-preview-as-user";

let previewing = false;
let listeners: Array<() => void> = [];
let initialized = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  previewing = read();
  // 跨标签页同步
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      previewing = read();
      listeners.forEach((fn) => fn());
    }
  });
}

export function isPreviewingAsUser(): boolean {
  init();
  return previewing;
}

export function setPreviewAsUser(on: boolean) {
  init();
  previewing = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 隐私模式下写不进去也无所谓，本次会话内仍然生效 */
  }
  listeners.forEach((fn) => fn());
}

export function subscribePreview(fn: () => void) {
  init();
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((x) => x !== fn);
  };
}

/**
 * 判断「当前是否应以管理员身份呈现」。
 *
 * 所有前端需要判断管理员的地方都应调用它，而不是直接用 me.isAdmin。
 */
export function effectiveIsAdmin(realIsAdmin: boolean): boolean {
  if (!realIsAdmin) return false;
  return !isPreviewingAsUser();
}
