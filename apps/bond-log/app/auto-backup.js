// BondLog 自動バックアップモジュール
// File System Access API を使用した自動バックアップ機能

import {
  AUTO_BACKUP_INTERVAL_MS,
  AUTO_BACKUP_HANDLE_KEY,
  CURRENT_SCHEMA_VERSION
} from "./constants.js";

import { currentPayload } from "./storage.js";

// --- 内部状態 ---

const autoBackup = {
  dirHandle: null,
  timerId: null,
  isRunning: false,
  hasChanges: true,
  lastHash: null,
  supported: typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
};

let autoBackupSoonTimer = null;
let autoBackupSilenceNextDirty = false;

const autoBackupElements = {
  button: typeof document !== "undefined" ? document.getElementById("auto-backup-btn") : null,
  changeBtn: typeof document !== "undefined" ? document.getElementById("auto-backup-change-btn") : null,
  clearBtn: typeof document !== "undefined" ? document.getElementById("auto-backup-clear-btn") : null,
  dirName: typeof document !== "undefined" ? document.getElementById("auto-backup-dir-name") : null,
  configured: typeof document !== "undefined" ? document.getElementById("auto-backup-configured") : null,
  status: typeof document !== "undefined" ? document.getElementById("auto-backup-status") : null
};

// applyNormalizedPayload コールバック（initAutoBackup で登録）
let applyPayloadCallback = null;

// --- KV ストア (IndexedDB "bondlog-settings") ---

function createHandleStore() {
  if (typeof indexedDB === "undefined") {
    return {
      get: async () => null,
      set: async () => {},
      del: async () => {}
    };
  }
  const DB_NAME = "bondlog-settings";
  const STORE = "kv";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = event => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error);
    });
    return dbPromise;
  }

  async function get(key) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const request = store.get(key);
      request.onsuccess = e => resolve(e.target.result);
      request.onerror = e => reject(e.target.error);
    });
  }

  async function set(key, value) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = e => reject(e.target.error);
    });
  }

  async function del(key) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = e => reject(e.target.error);
    });
  }

  return { get, set, del };
}

const handleStore = createHandleStore();

// --- ユーティリティ ---

function formatAutoBackupTimestamp(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function formatAutoBackupClock(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function sha256Hex(text) {
  if (!(crypto?.subtle)) throw new Error("Crypto API が利用できません");
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// --- ファイル操作 ---

async function writeFileToHandle(dirHandle, name, contents) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function fileExists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch (err) {
    return false;
  }
}

async function resolveArchiveName(dirHandle, baseName) {
  if (!(await fileExists(dirHandle, baseName))) return baseName;
  const dotIndex = baseName.lastIndexOf(".");
  const stem = dotIndex >= 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex >= 0 ? baseName.slice(dotIndex) : "";
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!(await fileExists(dirHandle, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

// --- バックアップ制御 ---

function setAutoBackupStatus(message, isError = false) {
  if (!autoBackupElements.status) return;
  autoBackupElements.status.textContent = message;
  autoBackupElements.status.classList.toggle("auto-backup-status--error", Boolean(isError));
}

function updateAutoBackupConfigUI() {
  const isConfigured = Boolean(autoBackup.dirHandle);
  if (autoBackupElements.button) {
    autoBackupElements.button.hidden = isConfigured;
  }
  if (autoBackupElements.configured) {
    autoBackupElements.configured.hidden = !isConfigured;
  }
  if (autoBackupElements.dirName) {
    autoBackupElements.dirName.textContent =
      isConfigured && autoBackup.dirHandle?.name ? `📁 ${autoBackup.dirHandle.name}` : "";
  }
}

function triggerAutoBackupSoon(forceImmediate = false) {
  if (!autoBackup.supported || !autoBackup.dirHandle) return;
  ensureAutoBackupTimer();
  if (forceImmediate) {
    runAutoBackup(true);
    return;
  }
  if (autoBackupSoonTimer) return;
  autoBackupSoonTimer = setTimeout(() => {
    autoBackupSoonTimer = null;
    runAutoBackup();
  }, 1500);
}

function ensureAutoBackupTimer() {
  if (autoBackup.timerId || !autoBackup.dirHandle) return;
  autoBackup.timerId = setInterval(() => runAutoBackup(), AUTO_BACKUP_INTERVAL_MS);
}

function stopAutoBackupTimer() {
  if (autoBackup.timerId) {
    clearInterval(autoBackup.timerId);
    autoBackup.timerId = null;
  }
}

async function ensureAutoBackupPermission(handle) {
  if (!handle?.queryPermission) return false;
  const opts = { mode: "readwrite" };
  let permission = await handle.queryPermission(opts);
  if (permission === "granted") return true;
  if (permission === "denied") return false;
  permission = await handle.requestPermission(opts);
  return permission === "granted";
}

async function readExistingAutoBackupHash(dirHandle) {
  try {
    const fileHandle = await dirHandle.getFileHandle("auto-backup.json");
    const file = await fileHandle.getFile();
    const text = await file.text();
    return await sha256Hex(text);
  } catch (err) {
    return null;
  }
}

async function onAutoBackupConfigure(event) {
  event.preventDefault();
  if (!autoBackup.supported || !autoBackupElements.button) return;
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    autoBackup.dirHandle = dirHandle;
    autoBackup.lastHash = await readExistingAutoBackupHash(dirHandle);
    await handleStore.set(AUTO_BACKUP_HANDLE_KEY, dirHandle);
    autoBackup.hasChanges = true;
    updateAutoBackupConfigUI();
    setAutoBackupStatus("設定完了");
    ensureAutoBackupTimer();
    triggerAutoBackupSoon(true);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("Auto backup configuration failed", err);
    setAutoBackupStatus(`設定に失敗: ${err?.message || err}`, true);
  }
}

async function onAutoBackupChange(event) {
  event.preventDefault();
  if (!autoBackup.supported) return;
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    autoBackup.dirHandle = dirHandle;
    autoBackup.lastHash = await readExistingAutoBackupHash(dirHandle);
    await handleStore.set(AUTO_BACKUP_HANDLE_KEY, dirHandle);
    autoBackup.hasChanges = true;
    updateAutoBackupConfigUI();
    setAutoBackupStatus("変更完了");
    ensureAutoBackupTimer();
    triggerAutoBackupSoon(true);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("Auto backup change failed", err);
    setAutoBackupStatus(`変更に失敗: ${err?.message || err}`, true);
  }
}

async function onAutoBackupClear(event) {
  event.preventDefault();
  await handleStore.del(AUTO_BACKUP_HANDLE_KEY);
  autoBackup.dirHandle = null;
  autoBackup.lastHash = null;
  autoBackup.hasChanges = true;
  stopAutoBackupTimer();
  updateAutoBackupConfigUI();
  setAutoBackupStatus("解除済み");
}

async function runAutoBackup(force = false) {
  if (!autoBackup.dirHandle || autoBackup.isRunning) return;
  const granted = await ensureAutoBackupPermission(autoBackup.dirHandle);
  if (!granted) {
    setAutoBackupStatus("バックアップ先の権限がありません", true);
    stopAutoBackupTimer();
    return;
  }
  if (!autoBackup.hasChanges && !force) {
    setAutoBackupStatus(`変更なし (${formatAutoBackupClock(new Date())})`);
    return;
  }
  autoBackup.isRunning = true;
  try {
    const payload = { ...currentPayload(), schemaVersion: CURRENT_SCHEMA_VERSION };
    const jsonText = JSON.stringify(payload, null, 2);
    const currentHash = await sha256Hex(jsonText);
    if (currentHash === autoBackup.lastHash && !force) {
      autoBackup.hasChanges = false;
      setAutoBackupStatus(`変更なし (${formatAutoBackupClock(new Date())})`);
      return;
    }
    const now = new Date();
    const archiveName = await resolveArchiveName(autoBackup.dirHandle, `backup-${formatAutoBackupTimestamp(now)}.json`);
    await writeFileToHandle(autoBackup.dirHandle, "auto-backup.json", jsonText);
    await writeFileToHandle(autoBackup.dirHandle, archiveName, jsonText);
    autoBackup.lastHash = currentHash;
    autoBackup.hasChanges = false;
    setAutoBackupStatus(`${archiveName} を保存（${formatAutoBackupClock(now)}）`);
  } catch (err) {
    console.error("Auto backup failed", err);
    setAutoBackupStatus(`バックアップ失敗: ${err?.message || err}`, true);
  } finally {
    autoBackup.isRunning = false;
  }
}

async function tryLoadFromAutoBackup() {
  if (!autoBackup.dirHandle) return false;
  try {
    const fileHandle = await autoBackup.dirHandle.getFileHandle("auto-backup.json");
    const file = await fileHandle.getFile();
    const jsonText = await file.text();
    const payload = JSON.parse(jsonText);
    if (applyPayloadCallback) {
      applyPayloadCallback(payload, { suppressAutoBackup: true });
    }
    autoBackup.lastHash = await sha256Hex(jsonText);
    autoBackup.hasChanges = false;
    setAutoBackupStatus("自動読込完了");
    return true;
  } catch (err) {
    console.warn("Auto backup load failed", err);
    setAutoBackupStatus("自動読込に失敗しました", true);
    return false;
  }
}

// --- エクスポート ---

/**
 * autoBackupSilenceNextDirty を true にする
 * applyNormalizedPayload から利用される
 */
export function silenceNextDirty() {
  autoBackupSilenceNextDirty = true;
}

/**
 * データ変更時に呼ばれるコールバック（saveAppData の第1引数に渡す）
 */
export function markAutoBackupDirty() {
  if (autoBackupSilenceNextDirty) {
    autoBackupSilenceNextDirty = false;
    return;
  }
  if (!autoBackup.supported) return;
  autoBackup.hasChanges = true;
  triggerAutoBackupSoon();
}

/**
 * 自動バックアップの初期化
 * @param {Function} applyPayloadFn - main.js の applyNormalizedPayload 関数
 */
export async function initAutoBackup(applyPayloadFn) {
  applyPayloadCallback = applyPayloadFn;
  if (!autoBackupElements.button || !autoBackupElements.status) return;
  if (!autoBackup.supported) {
    autoBackupElements.button.disabled = true;
    autoBackupElements.button.title = "このブラウザは File System Access API に対応していません";
    setAutoBackupStatus("このブラウザでは自動バックアップを利用できません", true);
    return;
  }
  if (!autoBackupElements.button.dataset.autoBackupBound) {
    autoBackupElements.button.addEventListener("click", onAutoBackupConfigure);
    if (autoBackupElements.changeBtn) {
      autoBackupElements.changeBtn.addEventListener("click", onAutoBackupChange);
    }
    if (autoBackupElements.clearBtn) {
      autoBackupElements.clearBtn.addEventListener("click", onAutoBackupClear);
    }
    autoBackupElements.button.dataset.autoBackupBound = "true";
  }
  try {
    const storedHandle = await handleStore.get(AUTO_BACKUP_HANDLE_KEY);
    if (storedHandle) {
      autoBackup.dirHandle = storedHandle;
      autoBackup.lastHash = await readExistingAutoBackupHash(storedHandle);
      updateAutoBackupConfigUI();
      setAutoBackupStatus("復元済み");
      ensureAutoBackupTimer();
      await tryLoadFromAutoBackup();
    } else {
      setAutoBackupStatus("未設定");
    }
  } catch (err) {
    console.warn("Auto backup init failed", err);
    setAutoBackupStatus(`初期化に失敗: ${err?.message || err}`, true);
  }
}

/**
 * 自動バックアップカードの折りたたみ初期化
 * @param {Function} setCollapsibleStateFn - main.js の setCollapsibleState 関数
 */
export function initAutoBackupCardCollapsible(setCollapsibleStateFn) {
  const card = document.getElementById('auto-backup-card');
  if (!card) {
    return;
  }
  const toggleBtn = card.querySelector('.auto-backup-toggle');
  const content = card.querySelector('.auto-backup-card__body');
  if (!toggleBtn || !content) {
    return;
  }
  const storageKey = 'bondlog:auto-backup-card:collapsed';
  const savedState = localStorage.getItem(storageKey);
  const startCollapsed = savedState === 'true';
  const applyState = (collapsed) => {
    setCollapsibleStateFn(card, content, toggleBtn, collapsed);
    content.style.display = collapsed ? 'none' : '';
  };
  applyState(startCollapsed);
  toggleBtn.addEventListener('click', () => {
    const nextCollapsed = !card.classList.contains('collapsed');
    applyState(nextCollapsed);
    localStorage.setItem(storageKey, String(nextCollapsed));
  });
}
