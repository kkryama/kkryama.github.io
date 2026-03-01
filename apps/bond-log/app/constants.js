// BondLog 定数定義

/** IndexedDB データベース名 */
export const DB_NAME = "BondLogDB";

/** IndexedDB オブジェクトストア名 */
export const STORE_NAME = "profiles";

/** 現在のスキーマバージョン */
export const CURRENT_SCHEMA_VERSION = 2;

/** リスナーごとに保持する URL の最大数 */
export const MAX_LISTENER_URLS = 5;

/** 自動バックアップ間隔（ミリ秒） */
export const AUTO_BACKUP_INTERVAL_MS = 30 * 1000;

/** 自動バックアップ設定の IndexedDB キー */
export const AUTO_BACKUP_HANDLE_KEY = "bondlog:auto-backup-dir";

/** プラットフォーム候補リスト */
export const PLATFORM_CANDIDATES = [
  "YouTube",
  "Twitch",
  "ツイキャス",
  "ニコニコ生放送",
  "Mirrativ",
  "IRIAM",
  "Palmu",
  "SHOWROOM",
  "REALITY",
  "TikTok LIVE",
  "17LIVE",
  "Mildom",
  "OPENREC",
  "Withny",
  "RPLAY",
];
