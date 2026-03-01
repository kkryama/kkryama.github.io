// BondLog ユーティリティ関数
// DOM非依存の純粋関数群

// === ID生成 ===

/** 一意なIDを生成する */
export const generateId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// === 日時処理 ===

/** 日付入力値をサニタイズし YYYY-MM-DD 形式で返す */
export const sanitizeDateInput = (raw) => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

/** 時刻入力値をサニタイズし HH:mm 形式で返す */
export const sanitizeTimeInput = (raw) => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const match = trimmed.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : "";
};

/** Date オブジェクトを YYYY-MM-DD 文字列へ変換する */
export const formatDateInputValue = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Date オブジェクトを HH:mm 文字列へ変換する */
export const formatTimeInputValue = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

/** 日付文字列と時刻文字列から ISO 8601 文字列を構築する */
export const buildIsoDateTime = (dateValue, timeValue) => {
  const sanitizedDate = sanitizeDateInput(dateValue);
  const sanitizedTime = sanitizeTimeInput(timeValue);
  if (!sanitizedDate) return new Date().toISOString();
  const [year, month, day] = sanitizedDate
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const [hours, minutes] = sanitizedTime
    ? sanitizedTime.split(":").map((part) => Number.parseInt(part, 10))
    : [0, 0];
  const localDate = new Date(
    year,
    (month || 1) - 1,
    day || 1,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
  return Number.isNaN(localDate.getTime())
    ? new Date().toISOString()
    : localDate.toISOString();
};

/** ISO 文字列を datetime-local 入力値へ変換する */
export const formatDateTimeLocalValue = (isoValue) => {
  const parsed = parseIsoDateTime(isoValue);
  if (!parsed) return "";
  const datePart = formatDateInputValue(parsed);
  const timePart = formatTimeInputValue(parsed);
  return datePart && timePart ? `${datePart}T${timePart}` : "";
};

/** datetime-local 入力値から ISO 8601 文字列を構築する */
export const buildIsoFromDateTimeLocal = (localValue) => {
  if (typeof localValue !== "string") return null;
  const trimmed = localValue.trim();
  if (!trimmed) return null;
  const [datePart, timePart] = trimmed.split("T");
  return buildIsoDateTime(datePart, timePart || "00:00");
};

// === URL処理 ===

/** URL入力値をサニタイズする */
export const sanitizeUrlInput = (raw) => {
  if (!raw) return "";
  return String(raw).trim().slice(0, 2048);
};

// === ISO 日時バリデーション ===

/** ISO 8601 文字列が有効かどうか判定する */
export const isValidIsoDateTime = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = new Date(trimmed);
  return !Number.isNaN(parsed.getTime());
};

/** ISO 8601 文字列を正規化する（無効値は null） */
export const normalizeIsoDateTime = (value) => {
  if (!isValidIsoDateTime(typeof value === "string" ? value : String(value || "")))
    return null;
  return String(value).trim();
};

/** ISO 8601 文字列を Date オブジェクトへパースする（無効値は null） */
export const parseIsoDateTime = (value) => {
  if (!isValidIsoDateTime(typeof value === "string" ? value : String(value || "")))
    return null;
  return new Date(value);
};

// === フォーマッタ ===

/** ISO 8601 文字列を日本語表示用の日時へ整形する */
export const formatDateTimeForDisplay = (value) => {
  if (!value) return "未記録";
  const parsed = parseIsoDateTime(value);
  if (!parsed) return "未記録";
  return parsed.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** 配信の日時表示文字列を生成する */
export const formatStreamSchedule = (stream) => {
  if (!stream) return "";
  const datePart = stream.date || "";
  const timePart = stream.startTime || "";
  if (datePart && timePart) return `${datePart} ${timePart}`;
  if (datePart) return datePart;
  return "日時未設定";
};

/** プラットフォーム表示ラベルを生成する */
export const formatProfileLabel = (profile) =>
  `[${profile.platform}] ${profile.accountName}`;

// === タグ・URL処理 ===

/** カンマ区切りの文字列をタグ配列にパースする（最大10個） */
export const parseTagsInput = (raw) =>
  (raw || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag)
    .slice(0, 10);

/** URL配列を正規化する（最大件数制限付き） */
export const normalizeListenerUrls = (raw, maxUrls = 5) => {
  if (!raw) return [];
  const source = Array.isArray(raw) ? raw : String(raw).split(/\r?\n|,/);
  const unique = [];
  source.forEach((entry) => {
    const sanitized = sanitizeUrlInput(entry);
    if (!sanitized) return;
    if (unique.includes(sanitized)) return;
    unique.push(sanitized);
  });
  return unique.slice(0, maxUrls);
};

// === ギフト金額パース ===

/** ギフト金額文字列を数値に変換する（変換不可は null） */
export const parseGiftAmount = (amount) => {
  if (!amount && amount !== 0) return null;
  const normalized = String(amount).replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

/** 配信の日付・時刻文字列から Date オブジェクトを生成する */
export const parseStreamDate = (dateStr, timeStr) => {
  if (!dateStr) return null;
  const normalizedDate = sanitizeDateInput(dateStr);
  if (!normalizedDate) return null;
  const normalizedTime = sanitizeTimeInput(timeStr);
  const base = normalizedTime
    ? `${normalizedDate}T${normalizedTime}`
    : `${normalizedDate}T00:00`;
  const parsed = new Date(base);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// === ロケール・フォーマッタ定数 ===

/** 日本語名前比較用コレーター */
export const nameCollator = new Intl.Collator("ja", { sensitivity: "base" });

/** 日本語数値フォーマッタ */
export const numberFormatter = new Intl.NumberFormat("ja-JP");
