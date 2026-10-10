/** 开源仓库（页脚求 Star 用） */
export const GITHUB_URL = "https://github.com/CompleX-maker/Lixin-ePower-Monitor";

/** 作者署名 */
export const AUTHOR = "初晓";

/** 课表站的源站（本站的登录入口跳到这里） */
export const SCHEDULE_ORIGIN = "https://stellaura.tech";

/** 本站自己的地址：登录完成后跳回这里 */
export const SELF_URL = "https://epower.stellaura.tech";

/**
 * 带回跳地址的课表站登录链接。
 * 课表站登录成功（或本来就已登录）后会自动 location.replace 回本站。
 */
export const SCHEDULE_LOGIN_URL = `${SCHEDULE_ORIGIN}/?redirect=${encodeURIComponent(SELF_URL)}`;

/**
 * ICP 备案号 —— 法规要求公开站点必须展示且可点击跳转到工信部查询平台。
 * 备案是按主域名（stellaura.tech）做的，子域名沿用同一个号。
 * 留空则不渲染。
 */
export const ICP_LICENSE = "冀ICP备2026041541号";
export const ICP_URL = "https://beian.miit.gov.cn/";

/** 公安联网备案（尚未办理，留空则不渲染） */
export const POLICE_LICENSE = "";
export const POLICE_URL = "https://beian.mps.gov.cn/";
