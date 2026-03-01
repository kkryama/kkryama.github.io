// アプリケーション状態管理モジュール
// 全モジュールから共有される可変状態を一元管理する

import { CURRENT_SCHEMA_VERSION } from "./constants.js";

// アプリケーション全体の共有状態
export const state = {
  db: null,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  profiles: [],
  listeners: [],
  statusCatalog: [],
  giftTemplates: [],
  currentProfile: null,
  currentStream: null,
  currentListener: null,
  listenerSortMode: "name-asc",
  platformSortMode: "name-asc",
  streamSearchQuery: "",
  topListenerPeriodFilter: "30",
  topListenerPlatformFilter: "all"
};

// リスナーIDからリスナーを取得（見つからなければ null）
export const getListenerById = listenerId =>
  state.listeners.find(listener => listener.id === listenerId) || null;

// プラットフォームに所属するリスナー一覧を取得
export const getProfileListeners = profileId =>
  state.listeners.filter(
    listener =>
      Array.isArray(listener.profileIds) &&
      listener.profileIds.includes(profileId)
  );

// リスナーをプラットフォームに関連付ける
export const linkListenerToProfile = (listener, profileId) => {
  if (!listener) return;
  if (!Array.isArray(listener.profileIds)) listener.profileIds = [];
  if (!listener.profileIds.includes(profileId))
    listener.profileIds.push(profileId);
};
