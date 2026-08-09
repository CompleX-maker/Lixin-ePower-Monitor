-- 电费监测站 建表脚本（从新数据库导入）
-- 用法: mysql -u用户 -p 数据库名 < schema.sql

SET NAMES utf8mb4;

-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dorms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sysid` int NOT NULL,
  `areaid` int NOT NULL,
  `buildid` int NOT NULL,
  `roomid` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `room_label` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` bigint NOT NULL,
  `email_to` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `card_user` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `card_pass` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=2030001;

-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `readings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `elec_kwh` double DEFAULT NULL,
  `card_balance` double DEFAULT NULL,
  `ok` tinyint(1) NOT NULL DEFAULT '1',
  `err_msg` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fetched_at` bigint NOT NULL,
  `dorm_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=513089;

-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`key`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

