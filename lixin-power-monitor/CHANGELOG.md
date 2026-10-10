# 更新日志

本项目所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 说明：本文件于 2026-10-10 补写，`0.3.4` 及以前的版本号是按 git 提交历史回溯编排的，
> 早期提交本身没有打版本标记。

## [0.3.4] - 2026-10-10

### 新增
- **一个账号只能绑定一个宿舍**
  - `addDorm` / `claimDorm` 增加配额校验，已有宿舍的账号不能再添加或认领（管理员不受限）
  - 新增 `monitor.canAddDorm` 接口，前端据此决定「添加宿舍」按钮与待认领区块是否显示
  - 已有宿舍时 `unclaimedDorms` 返回空，数据层不再泄露待认领列表

### 修复
- 删除宿舍的按钮原先只在 `dorms.length > 1` 时显示，配额生效后该条件永远为假，
  会导致用户无法删掉旧宿舍去换新的；改为常显

## [0.3.3] - 2026-10-10

### 新增
- **登录跳转带回跳地址**：引导用户去课表站登录时带上 `?redirect=`，
  课表站登录成功（或本来已登录）后自动跳回本站，不再需要手动切标签页
- 刷新按钮给出明确反馈（检查中 / 未检测到登录时给出排查提示）

## [0.3.2] - 2026-10-10

### 修复
- 登录引导改为**新标签页**打开课表站，避免「跳过去就回不来」——
  原先在本页跳走，用户登录完找不到回来的入口

## [0.3.1] - 2026-10-10

### 新增
- **宿舍自主认领**：管理员预置宿舍后，学生可一键认领到自己名下
  （`claimDormAs` 用 `WHERE card_user IS NULL` 保证并发安全）

### 修复
- 宿舍选择器滚轮回弹到顶部：Radix Select 默认 `position="item-aligned"`
  会把选中项重新滚进视野，改为 `position="popper"`

## [0.3.0] - 2026-10-10

### 新增
- **接入课表站单点登录（SSO）**：复用课表站的会话 cookie `lixin_jw_sid`，
  免去第二套账号体系
  - cookie Domain 为 `.stellaura.tech`，子域自动携带
  - 用 `node:crypto` 手工验签 HS256，不引入 JWT 库
  - 密钥 `scrypt(SSO_SECRET, "lixin-jw-session-v1", 32)`
  - 算法白名单 + `timingSafeEqual`，防算法降级与时序侧信道
- **按学号隔离宿舍可见范围**：每个人只看得到绑定在自己名下（或自己认领）的宿舍，
  管理员可看全部
- tRPC 过程分层：`publicQuery` / `authedQuery` / `adminQuery`

## [0.2.0] - 2026-10-10

### 安全
- **凭据加密存储**：一卡通密码、邮箱授权码、Server酱 SendKey 等敏感字段，
  落库前用 AES-256-GCM 加密（格式 `v1.<iv>.<tag>.<ciphertext>`），
  密钥由 `APP_SECRET` 经 scrypt 派生；历史明文值读取时自动兼容
- 提供一次性迁移脚本 `api/migrate-encrypt.ts`，把存量明文刷成密文
- **从仓库移除 `data.sql`**：该文件含学校统一身份认证密码、QQ 邮箱 SMTP 授权码
  与 Server酱 SendKey，属于不该进版本库的明文凭据

### 修复
- 修正 `.gitignore`：上一次提交误把 `data.sql` 的忽略规则注释掉了，导致它被重新加入

## [0.1.0] - 2026-08-10

### 新增
- 初版：多宿舍电费监测 + 账号号池 + QQ 邮箱日报
  - 单个一卡通账号可为多个宿舍抓取读数（号池复用会话）
  - 剩余电量 / 一卡通余额 / 预计可用天数 / 近 24 小时耗电四项指标
  - 电量变化曲线（24 小时 / 7 天 / 30 天）
  - 低电量邮件提醒，支持每个宿舍配专属收件邮箱
  - 每天 18:00 日报
- 技术栈：Node 20 + Hono + tRPC 11 + Drizzle ORM + MySQL 8，
  前端 React 19 + Vite + Tailwind CSS + shadcn/ui

### 说明
- 仓库中同时残留了更早的 Flask 原型文件（`Procfile`、`requirements.txt`、
  `railway.json`、`schema.sql`），未在本版清理
