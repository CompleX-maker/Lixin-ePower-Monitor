/**
 * 一次性迁移：把历史明文凭据改为加密存储
 *
 * 处理对象：
 *   - dorms.card_pass                    （各宿舍绑定的一卡通密码）
 *   - settings: ykt_password             （全局一卡通密码）
 *   - settings: email_pass               （QQ 邮箱 SMTP 授权码）
 *   - settings: sct_sendkey              （Server酱 SendKey）
 *
 * 幂等：已加密的值会被跳过（isEncrypted 判断 v1. 前缀）。
 */
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { dorms, settings } from "@db/schema";
import { encryptSecret, isEncrypted } from "./lib/crypto";

const SENSITIVE_SETTING_KEYS = ["ykt_password", "email_pass", "sct_sendkey"];

async function main() {
  const db = getDb();
  let dormCount = 0;
  let settingCount = 0;

  /* ---------- dorms.card_pass ---------- */
  const dormRows = await db.select().from(dorms);
  for (const d of dormRows) {
    if (!d.cardPass || isEncrypted(d.cardPass)) continue;
    await db
      .update(dorms)
      .set({ cardPass: encryptSecret(d.cardPass) })
      .where(eq(dorms.id, d.id));
    dormCount++;
  }

  /* ---------- settings ---------- */
  for (const key of SENSITIVE_SETTING_KEYS) {
    const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
    if (!row?.value || isEncrypted(row.value)) continue;
    await db
      .update(settings)
      .set({ value: encryptSecret(row.value) })
      .where(eq(settings.key, key));
    settingCount++;
  }

  console.log(`[migrate] dorms.card_pass 加密 ${dormCount} 条`);
  console.log(`[migrate] settings 加密 ${settingCount} 条`);
  console.log("[migrate] 完成");
  process.exit(0);
}

main().catch((e) => {
  console.error("[migrate] 失败:", e);
  process.exit(1);
});
