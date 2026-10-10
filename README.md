# 立信电费监测站（Lixin ePower Monitor）

上海立信会计金融学院宿舍电费监测站：绑定宿舍后自动定时抓取剩余电量与一卡通余额，
给出预计可用天数、近 24 小时耗电和电量变化曲线，余额偏低时通过邮件 / Server酱推送提醒。

线上：<https://epower.stellaura.tech>

## 功能

- **定时抓取**：服务端按读数新旧自动锚定下一次抓取，页面上的「下次抓取」倒计时是实时的
- **四项关键指标**：剩余电量（度）、一卡通余额（元）、预计可用天数、近 24 小时耗电
- **电量变化曲线**：24 小时 / 7 天 / 30 天三档，带充值点标注
- **低电量提醒**：低于阈值时推送；每个宿舍可单独配专属收件邮箱
- **每日日报**：每天 18:00 给配了专属邮箱的宿舍各发一封，全局收件箱另发一封汇总
- **多宿舍**：一个账号绑定一个宿舍，管理员可管理全部
- **访客统计（仅管理员）**：累计访客与访问次数、今日 / 近 7 天 / 近 30 天分布、访问名单与最近流水（不记录 IP）
- **管理员视角开关**：一键把界面切成普通用户视图，用来自查管理功能有没有漏隐藏（刷新后保持）
- **宿舍自主认领**：管理员预置好宿舍，学生自己认领到自己名下
- **与课表站单点登录**：课表站登录一次，本站免登（详见下文）
- **可安装到桌面**：带完整图标集与 PWA manifest，可添加到主屏幕

## 和课表站的关系

本站不是一个独立账号体系，而是 **复用 [立信课表](https://stellaura.tech) 的会话**：

```
用户在课表站登录
   → 课表站签发 HS256 JWT，写进 cookie `lixin_jw_sid`
     cookie Domain = `.stellaura.tech`（见课表站 COOKIE_DOMAIN）
   → 同一浏览器访问 epower.stellaura.tech，cookie 自动带上
   → 本站用 SSO_SECRET（= 课表站 APP_SECRET）本地验签，取出学号
```

验签是手工实现的（`node:crypto`，没有为一个 HS256 校验引入 JWT 库）：

- 密钥：`scrypt(SSO_SECRET, "lixin-jw-session-v1", 32)`
- 算法白名单：只接受 `HS256`，防 `alg=none` 降级
- 签名比较用 `timingSafeEqual`，防时序侧信道
- 过期校验读 `exp`

未登录时的登录引导是**新标签页**打开课表站并带上回跳地址：

```
https://stellaura.tech/?redirect=https%3A%2F%2Fepower.stellaura.tech%2F
```

课表站登录成功（或本来已登录）后会自动 `location.replace` 回来，不用手动切标签页。

## 技术栈

- 前端：React 19 + Vite 7 + Tailwind CSS + shadcn/ui + Recharts
- 后端：Hono + tRPC 11（端到端类型安全）
- 数据库：MySQL 8 + Drizzle ORM
- 运行时：Node 20
- 抓取链路：CAS 统一身份认证（`cas.paas.lixin.edu.cn`）→ 一卡通/电费（`ykt.lixin.edu.cn`）

## 仓库结构

```
.
├── README.md / CHANGELOG.md / .env.example
├── lixin-power-monitor/     ← 应用本体（Node + React 全栈）
│   └── public/              ← 图标与 PWA manifest（构建时原样拷到 dist/public）
└── Procfile, requirements.txt, railway.json, schema.sql
                            ← 更早的 Flask 原型遗留，已不再使用
```

> 根目录的 `Procfile` / `requirements.txt` / `railway.json` / `schema.sql`
> 是第一版 Flask 原型留下的，现在的应用完全基于 Node，这些文件不参与构建与部署。

## 数据表

| 表 | 说明 |
|---|---|
| `dorms` | 宿舍（校区 / 楼栋 / 房间号 + 归属学号 + 专属邮箱 + 加密后的一卡通账密） |
| `readings` | 每次抓取的读数快照（电量、余额、成功与否、错误信息、抓取时间） |
| `settings` | 全局配置（抓取间隔、提醒阈值、SMTP、Server酱 SendKey 等，敏感项加密存储） |
| `visit_logs` | 访客统计（学号 + 姓名快照 + 访问时间，同一学号 5 分钟内只记一条；不含 IP） |

## 快速开始

```bash
git clone https://github.com/CompleX-maker/Lixin-ePower-Monitor.git
cd Lixin-ePower-Monitor

# 应用本体在 lixin-power-monitor/ 子目录
cd lixin-power-monitor
pnpm install
cp ../.env.example .env    # 然后按注释把 DB 连接串和两把密钥填好
pnpm db:push               # 初始化数据库表
pnpm build
pnpm start                 # 生产模式（含定时抓取与日报调度器）
```

开发模式前后端一起跑：

```bash
pnpm dev
```

### 环境变量

参考 `.env.example`：

```bash
PORT=3001
DATABASE_URL=mysql://user:pass@127.0.0.1:3306/lixin_epower

# 会话签名密钥（本站不用 Kimi 登录，这两项仅用于满足启动校验）
APP_ID=selfhost
APP_SECRET=<用 openssl rand -base64 32 生成>

# 共用课表站会话：填课表站的 APP_SECRET，用于验签它签发的 JWT
SSO_SECRET=<课表站的 APP_SECRET>
ADMIN_STUDENT_IDS=2025000001  # 这些学号登录后自动成为管理员（逗号分隔）
```

> `APP_SECRET` 与 `SSO_SECRET` 是两把不同的密钥，用途也不同：
> 前者用于本站自己的加密（派生凭据 AES 密钥），后者只用于验签课表站的会话。
> 注意 `SSO_SECRET` 必须和课表站的 `APP_SECRET` **完全一致**，否则全员掉线。

### 反向代理

需要 HTTPS 时在前面挂 Nginx / Caddy 反代到 `3001` 端口：

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;                      # Nginx ≥ 1.25.1；1.24 用 listen 443 ssl http2;
    server_name epower.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配成 systemd 服务并设 `Restart=always`，避免服务器重启后掉线。

### 抓取依赖：aTrust 零信任网关

学校自 2026-09-20 起为教务与一卡通相关域名接入深信服 aTrust 网关，
**服务端必须先跑起 aTrust 客户端并登录上线**，否则抓取会被网关拦截
（表现为 302 跳到 `atrust.lixin.edu.cn` 做 JS 环境校验）。

aTrust 客户端的服务器侧部署步骤见课表站 README 的
[自部署 aTrust 客户端](https://github.com/CompleX-maker/lixin-schedule#自部署-atrust-客户端服务器侧必读)。

> aTrust 会话有有效期（学校每天 06:00 强制下线），掉线后需 VNC 连上桌面重新扫码。

## 安全

- **凭据加密存储**：一卡通密码、邮箱授权码、Server酱 SendKey 等敏感字段用
  AES-256-GCM 加密后落库，格式 `v1.<iv>.<tag>.<ciphertext>`，密钥由 `APP_SECRET`
  经 scrypt 派生；历史明文值读取时自动兼容
- **接口分层**：tRPC 过程分为 `publicQuery` / `authedQuery` / `adminQuery` 三级，
  未登录返回 401，非管理员返回 403
- **数据隔离**：宿舍读数的查询都按「当前学号名下的宿舍」过滤，
  后端不做「管理员看全部」之外的越权放行；写入前校验宿舍归属
- **全局配置仅管理员可见**：一卡通号池账号、发件 QQ 邮箱、SMTP 授权码、
  Server酱 SendKey 这些属于全局配置，非管理员调用 `getSettings` 时一律不下发，
  界面上也整块不渲染；普通用户只有一张「我的接收邮箱」卡片
- **敏感信息脱敏**：即便是管理员，`getSettings` 返回的 SendKey 也只给打码后的值
- **一个账号一个宿舍**：`addDorm` / `claimDorm` 在服务端做配额校验，防止一个账号占多个宿舍
- 部署时 `.env` 权限设 `600`，并确保 `data.sql` 之类含明文凭据的备份不进仓库

已知不足：密钥没有轮换机制，也没有接 KMS；`APP_SECRET` 一旦泄露需要手动轮换并重新加密全部字段。

## 免责声明

本项目为学习交流用途的第三方工具，与学校官方无关。账号密码仅用于登录学校系统抓取读数，
请自行评估风险后使用。

## License

MIT
