import {
  mysqlTable,
  serial,
  varchar,
  text,
  double,
  bigint,
  boolean,
  int,
} from "drizzle-orm/mysql-core";

// 被监测的宿舍（eleresult 页面参数组合唯一确定一个房间）
export const dorms = mysqlTable("dorms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(), // 用户备注名，如「我们宿舍」
  sysid: int("sysid").notNull(), // 电控系统：3=中山西路及上川路 4=新苑一二三
  areaid: int("areaid").notNull(), // 校区
  buildid: int("buildid").notNull(), // 楼栋
  roomid: varchar("roomid", { length: 64 }).notNull(), // 新苑一二三系统的房间号是 "3-1001" 这类字符串 // 房间
  roomLabel: varchar("room_label", { length: 64 }), // 房间显示名，如 6-520
  emailTo: varchar("email_to", { length: 256 }), // 该宿舍专属收件邮箱（多个用逗号隔开），空 = 只进全局汇总邮件
  cardUser: varchar("card_user", { length: 64 }), // 绑定的一卡通账号（查该宿舍余额用），空 = 未绑定显示「暂无」
  cardPass: varchar("card_pass", { length: 256 }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// 每次抓取的读数：剩余电量(度) + 一卡通余额(元)
export const readings = mysqlTable("readings", {
  id: serial("id").primaryKey(),
  dormId: bigint("dorm_id", { mode: "number", unsigned: true }), // 关联 dorms.id（历史数据可能为空）
  elecKwh: double("elec_kwh"), // 剩余电量（度），失败时为 null
  cardBalance: double("card_balance"), // 一卡通余额（元），失败时为 null
  ok: boolean("ok").notNull().default(true), // 本次抓取是否成功
  errMsg: varchar("err_msg", { length: 500 }), // 失败原因
  fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(), // epoch 毫秒
});

// 键值配置表：账号密码/阈值/推送key/轮询间隔等都存这里（仅服务端可读）
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
});

// 访客统计：谁在什么时候打开过本站。
// 仅保存身份快照（学号 + 姓名），不记录 IP 与设备信息。
// 同一学号 5 分钟内只记一条，避免刷新刷屏。
export const visitLogs = mysqlTable("visit_logs", {
  id: serial("id").primaryKey(),
  studentId: varchar("student_id", { length: 64 }).notNull(),
  realName: varchar("real_name", { length: 64 }),
  visitedAt: bigint("visited_at", { mode: "number" }).notNull(), // epoch 毫秒
});
