// BondLog データサニタイズ・正規化
// データの入力検証と変換を行う純粋関数群

import {
  generateId,
  sanitizeDateInput,
  sanitizeTimeInput,
  formatDateInputValue,
  sanitizeUrlInput,
  normalizeIsoDateTime,
  normalizeListenerUrls,
} from "./utils.js";
import { CURRENT_SCHEMA_VERSION, MAX_LISTENER_URLS } from "./constants.js";

// === デフォルトデータ生成 ===

/** デフォルトのギフトテンプレートを生成する（現在は空配列） */
export const createDefaultGiftTemplates = () => [];

/** デフォルトの初期データを生成する */
export const createDefaultData = () => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  profiles: [],
  listeners: [],
  statusCatalog: [],
  giftTemplates: createDefaultGiftTemplates(),
});

// === 個別エンティティのサニタイズ ===

/** 登録者履歴エントリをサニタイズする */
export const sanitizeFollowerHistoryEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id || generateId("fh");
  const date =
    sanitizeDateInput(entry.date) || formatDateInputValue(new Date());
  const count =
    typeof entry.count === "number" && entry.count >= 0 ? entry.count : 0;
  const note =
    typeof entry.note === "string" ? entry.note.trim().slice(0, 500) : "";
  return { id, date, count, note };
};

/** ギフト記録をサニタイズする */
export const sanitizeGift = (gift) => {
  if (!gift || typeof gift !== "object") return null;
  const listenerId =
    typeof gift.listenerId === "string" ? gift.listenerId.trim() : "";
  const item =
    typeof gift.item === "string" ? gift.item.trim().slice(0, 200) : "";
  const amount =
    typeof gift.amount === "string" ? gift.amount.trim().slice(0, 100) : "";
  if (!listenerId || !item) return null;
  return { listenerId, item, amount };
};

/** 配信記録をサニタイズする */
export const sanitizeStream = (stream) => {
  if (!stream || typeof stream !== "object")
    return {
      id: generateId("s"),
      title: "",
      date: formatDateInputValue(new Date()),
      attendees: [],
      gifts: [],
    };
  const id = stream.id || generateId("s");
  const title = (stream.title || "").trim().slice(0, 200);
  const date = sanitizeDateInput(
    stream.date ||
      stream.startDate ||
      (stream.scheduledAt ? stream.scheduledAt.split("T")[0] : "")
  );
  const startTime = sanitizeTimeInput(
    stream.startTime ||
      (stream.scheduledAt ? stream.scheduledAt.split("T")[1] : "")
  );
  const url = sanitizeUrlInput(stream.url);
  const attendees = Array.isArray(stream.attendees)
    ? stream.attendees.filter((id) => typeof id === "string" && id.trim())
    : [];
  const gifts = Array.isArray(stream.gifts)
    ? stream.gifts.map(sanitizeGift).filter(Boolean)
    : [];
  return { id, title, date, startTime, url, attendees, gifts };
};

/** プラットフォーム情報をサニタイズする */
export const sanitizeProfile = (profile) => {
  if (!profile || typeof profile !== "object")
    return {
      id: generateId("p"),
      platform: "",
      accountName: "",
      streams: [],
      followerHistory: [],
    };
  const id = profile.id || generateId("p");
  const normalizedUrl = (profile.url || "").trim().slice(0, 2048);
  const normalizedNote = (profile.note || "").trim().slice(0, 1000);
  const followerHistory = Array.isArray(profile.followerHistory)
    ? profile.followerHistory.map(sanitizeFollowerHistoryEntry).filter(Boolean)
    : [];
  return {
    id,
    platform: (profile.platform || "").trim(),
    accountName: (profile.accountName || "").trim(),
    url: normalizedUrl,
    note: normalizedNote,
    streams: Array.isArray(profile.streams)
      ? profile.streams.map(sanitizeStream)
      : [],
    followerHistory,
  };
};

/** ステータス付与履歴をサニタイズする */
export const sanitizeStatusAssignment = (assignment) => {
  if (!assignment || typeof assignment !== "object") return null;
  const statusId =
    typeof assignment.statusId === "string" ? assignment.statusId.trim() : "";
  if (!statusId) return null;
  const source = assignment.source === "system" ? "system" : "manual";
  const activatedAt = normalizeIsoDateTime(assignment.activatedAt);
  const deactivatedAt = normalizeIsoDateTime(assignment.deactivatedAt);
  const reason =
    typeof assignment.reason === "string" ? assignment.reason.trim() : "";
  const note =
    typeof assignment.note === "string" ? assignment.note.trim() : "";
  return {
    statusId,
    source,
    activatedAt,
    deactivatedAt,
    reason,
    note,
  };
};

/** リスナー情報をサニタイズする */
export const sanitizeListener = (listener) => {
  if (!listener || typeof listener !== "object")
    return {
      id: generateId("l"),
      name: "",
      tags: [],
      memo: "",
      profileIds: [],
      urls: [],
      statusAssignments: [],
    };
  const id = listener.id || generateId("l");
  const tags = Array.isArray(listener.tags)
    ? listener.tags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag)
        .slice(0, 10)
    : [];
  const profileIds = Array.isArray(listener.profileIds)
    ? listener.profileIds.filter((pid) => typeof pid === "string")
    : [];
  const name = typeof listener.name === "string" ? listener.name.trim() : "";
  const memo =
    typeof listener.memo === "string" ? listener.memo.slice(0, 1000) : "";
  const statusAssignments = Array.isArray(listener.statusAssignments)
    ? listener.statusAssignments.map(sanitizeStatusAssignment).filter(Boolean)
    : [];
  return {
    id,
    name,
    tags,
    memo,
    profileIds,
    urls: normalizeListenerUrls(listener.urls, MAX_LISTENER_URLS),
    statusAssignments,
  };
};

/** ギフトテンプレートをサニタイズする */
export const sanitizeGiftTemplate = (template) => {
  if (!template || typeof template !== "object") return null;
  const id = template.id || generateId("gt");
  const rawItem =
    typeof template.item === "string" ? template.item.trim() : "";
  const rawName =
    typeof template.name === "string" ? template.name.trim() : "";
  const rawAmount =
    typeof template.amount === "string"
      ? template.amount.trim()
      : template.amount === undefined
        ? ""
        : String(template.amount);
  const name = rawName || rawItem;
  if (!name && !rawItem) return null;
  return {
    id,
    name: name || "テンプレート",
    item: rawItem,
    amount: rawAmount,
  };
};

/** ステータス定義をサニタイズする */
export const sanitizeStatusDefinition = (definition) => {
  if (!definition || typeof definition !== "object") return null;
  const id =
    typeof definition.id === "string" && definition.id.trim()
      ? definition.id.trim()
      : generateId("status_");
  const displayName =
    typeof definition.displayName === "string"
      ? definition.displayName.trim()
      : "";
  const description =
    typeof definition.description === "string"
      ? definition.description.trim()
      : "";
  const priorityValue = Number.parseInt(definition.displayPriority, 10);
  const displayPriority = Number.isFinite(priorityValue) ? priorityValue : 0;
  const isArchived = Boolean(definition.isArchived);
  return {
    id,
    displayName,
    description,
    displayPriority,
    isArchived,
  };
};

// === レガシーデータ変換 ===

/** 旧フォーマット（profiles配列のみ）を現行構造へ変換する */
export const convertLegacyProfiles = (legacyProfiles) => {
  const migratedProfiles = [];
  const migratedListeners = [];
  (Array.isArray(legacyProfiles) ? legacyProfiles : []).forEach(
    (rawProfile) => {
      const sanitizedProfile = sanitizeProfile(rawProfile);
      const profileId = sanitizedProfile.id;
      const legacyListeners = Array.isArray(
        rawProfile && rawProfile.listeners
      )
        ? rawProfile.listeners
        : [];
      const idMap = new Map();
      legacyListeners.forEach((rawListener) => {
        if (!rawListener || typeof rawListener !== "object") return;
        const proposedKey = rawListener.id || generateId("l");
        const finalId = idMap.has(proposedKey) ? generateId("l") : proposedKey;
        idMap.set(rawListener.id || finalId, finalId);
        const sanitizedListener = sanitizeListener({
          ...rawListener,
          id: finalId,
          profileIds: [profileId],
        });
        sanitizedListener.profileIds = [profileId];
        migratedListeners.push(sanitizedListener);
      });
      sanitizedProfile.streams = sanitizedProfile.streams.map((stream) => {
        const attendees = Array.isArray(stream.attendees)
          ? stream.attendees.map((id) => idMap.get(id) || id)
          : [];
        const gifts = Array.isArray(stream.gifts)
          ? stream.gifts.map((gift) => {
              if (!gift || typeof gift !== "object") return gift;
              const mappedId = gift.listenerId
                ? idMap.get(gift.listenerId) || gift.listenerId
                : gift.listenerId;
              return { ...gift, listenerId: mappedId };
            })
          : [];
        return { ...stream, attendees, gifts };
      });
      migratedProfiles.push(sanitizedProfile);
    }
  );
  return {
    schemaVersion: 1,
    profiles: migratedProfiles,
    listeners: migratedListeners.map((listener) => ({
      ...listener,
      statusAssignments: listener.statusAssignments || [],
    })),
    statusCatalog: [],
    giftTemplates: createDefaultGiftTemplates(),
  };
};

// === データ正規化 ===

/** 任意のインポートデータを現行スキーマに正規化する */
export const normalizeData = (raw) => {
  if (!raw) return createDefaultData();
  if (Array.isArray(raw)) return convertLegacyProfiles(raw);
  const hasProfiles = Array.isArray(raw.profiles);
  const hasListeners = Array.isArray(raw.listeners);
  if (!hasProfiles) return createDefaultData();
  if (!hasListeners) return convertLegacyProfiles(raw.profiles);
  const sanitizedTemplates = Array.isArray(raw.giftTemplates)
    ? raw.giftTemplates.map(sanitizeGiftTemplate).filter(Boolean)
    : createDefaultGiftTemplates();
  const sanitizedStatusesRaw = Array.isArray(raw.statusCatalog)
    ? raw.statusCatalog.map(sanitizeStatusDefinition).filter(Boolean)
    : [];
  const statusMap = new Map();
  sanitizedStatusesRaw.forEach((status) => {
    if (statusMap.has(status.id)) return;
    statusMap.set(status.id, status);
  });
  const sanitizedStatusCatalog = Array.from(statusMap.values());
  const schemaVersion = Number.isFinite(raw.schemaVersion)
    ? raw.schemaVersion
    : statusMap.size > 0
      ? CURRENT_SCHEMA_VERSION
      : 1;
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const rawListeners = Array.isArray(raw.listeners) ? raw.listeners : [];
  const profiles = rawProfiles.map(sanitizeProfile);
  const listeners = rawListeners.map(sanitizeListener);
  return {
    schemaVersion,
    profiles,
    listeners,
    giftTemplates: sanitizedTemplates,
    statusCatalog: sanitizedStatusCatalog,
  };
};
