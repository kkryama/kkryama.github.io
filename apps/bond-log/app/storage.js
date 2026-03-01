// IndexedDB ストレージモジュール
// データの永続化・読み込みを担当する

import { DB_NAME, STORE_NAME, CURRENT_SCHEMA_VERSION } from "./constants.js";
import { normalizeData, createDefaultData } from "./sanitize.js";
import { state } from "./state.js";

// IndexedDB を開く
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME))
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => {
      state.db = req.result;
      resolve(state.db);
    };
    req.onerror = e => reject(e);
  });
}

// 現在の状態をペイロードとして返す
export function currentPayload() {
  return {
    schemaVersion: state.schemaVersion,
    profiles: state.profiles,
    listeners: state.listeners,
    statusCatalog: state.statusCatalog,
    giftTemplates: state.giftTemplates
  };
}

// IndexedDB にアプリデータを保存する
// onDirty: 保存後に呼ばれるコールバック（自動バックアップの通知用）
export function saveAppData(onDirty) {
  const tx = state.db.transaction(STORE_NAME, "readwrite");
  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  const payload = currentPayload();
  tx.objectStore(STORE_NAME).put({ id: "main", data: payload });
  if (typeof onDirty === "function") onDirty();
}

// IndexedDB からアプリデータを読み込む
export async function loadAppData() {
  const tx = state.db.transaction(STORE_NAME, "readonly");
  const req = tx.objectStore(STORE_NAME).get("main");
  return new Promise(res => {
    req.onsuccess = () => {
      const payload = req.result ? req.result.data : null;
      res(normalizeData(payload));
    };
    req.onerror = () => res(createDefaultData());
  });
}
