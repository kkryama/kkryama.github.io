// BondLog プラットフォーム管理モジュール
// プラットフォーム一覧、配信一覧、登録者数推移の描画・操作を管理する

import {
  generateId, sanitizeDateInput, sanitizeTimeInput, sanitizeUrlInput,
  formatDateInputValue, formatStreamSchedule, formatProfileLabel,
  nameCollator
} from "./utils.js";
import { PLATFORM_CANDIDATES } from "./constants.js";
import { sanitizeStream, sanitizeFollowerHistoryEntry } from "./sanitize.js";
import { state } from "./state.js";
import { saveAppData } from "./storage.js";
import { markAutoBackupDirty } from "./auto-backup.js";
import { openModal, closeModal } from "./modal.js";
import {
  showView, refreshCurrentView, updateTabState, switchLocalTab,
  createActionButton
} from "./navigation.js";
// 循環依存あり: stream-events.js, listener.js（ランタイム参照のみ）
import { openStream } from "./stream-events.js";
import { refreshListenerDetail } from "./listener.js";

// --- コールバック: main.js のオーケストレーション関数 ---
let _initLocalTabsFn = null;

/** main.js の initLocalTabs を登録する */
export const registerInitLocalTabs = fn => { _initLocalTabsFn = fn; };

/** 配信URLリンクを表示・更新するヘルパー */
export const updateStreamUrlLink = stream => {
  const container = document.getElementById("stream-url");
  if (!container) return;
  container.innerHTML = "";
  if (!stream || !stream.url) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  const label = document.createTextNode("配信URL: ");
  container.appendChild(label);
  const anchor = document.createElement("a");
  anchor.href = stream.url;
  anchor.textContent = stream.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  container.appendChild(anchor);
};

export const renderPlatformList = () => {
  const list = document.getElementById("platform-list");
  const emptyState = document.getElementById("platform-empty");

  if (!list || !emptyState) return;

  list.innerHTML = "";

  if (state.profiles.length === 0) {
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
  }

  const sortSelect = document.getElementById("platform-sort");
  if (sortSelect) sortSelect.value = state.platformSortMode;

  const compareNameAsc = (a, b) => {
    const result = nameCollator.compare((a.platform || "").trim(), (b.platform || "").trim());
    if (result !== 0) return result;
    return nameCollator.compare((a.accountName || "").trim(), (b.accountName || "").trim());
  };

  const sorted = [...state.profiles];
  sorted.sort((a, b) => {
    switch (state.platformSortMode) {
      case "name-desc":
        return compareNameAsc(b, a);
      default:
        return compareNameAsc(a, b);
    }
  });

  sorted.forEach(profile => {
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "list-item-header";

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = formatProfileLabel(profile);
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    actions.appendChild(createActionButton("編集", "edit", () => openProfileEditor(profile)));
    actions.appendChild(createActionButton("削除", "danger", () => confirmDeleteProfile(profile)));
    header.appendChild(actions);

    li.appendChild(header);
    li.onclick = () => openProfile(profile.id);
    list.appendChild(li);
  });
};

const openProfileEditor = profile => {
  openModal("プラットフォーム編集", [
    {
      name: "platform",
      label: "プラットフォーム名",
      type: "datalist",
      options: PLATFORM_CANDIDATES,
      value: profile.platform || ""
    },
    { name: "accountName", label: "アカウント名", value: profile.accountName || "" },
    {
      name: "url",
      label: "プラットフォーム URL（任意）",
      type: "url",
      value: profile.url || "",
      placeholder: "https://example.com"
    },
    {
      name: "note",
      label: "備考（任意）",
      type: "textarea",
      value: profile.note || ""
    }
  ], values => {
    profile.platform = (values.platform || "").trim();
    profile.accountName = (values.accountName || "").trim();
    profile.url = (values.url || "").trim().slice(0, 2048);
    profile.note = (values.note || "").trim().slice(0, 1000);
    refreshCurrentView();
    if (state.currentProfile && state.currentProfile.id === profile.id) {
      state.currentProfile.platform = profile.platform;
      state.currentProfile.accountName = profile.accountName;
      state.currentProfile.url = profile.url;
      state.currentProfile.note = profile.note;
      document.getElementById("profile-title").textContent = formatProfileLabel(state.currentProfile);
      renderStreams();
    }
  });
};

const confirmDeleteProfile = profile => {
  if (!confirm(`${formatProfileLabel(profile)} を削除します。関連する配信・参加記録・ギフト履歴も削除されます。よろしいですか？`)) return;
  state.profiles = state.profiles.filter(p => p.id !== profile.id);
  state.listeners.forEach(listener => {
    if (!Array.isArray(listener.profileIds)) return;
    listener.profileIds = listener.profileIds.filter(pid => pid !== profile.id);
  });
  if (state.currentProfile && state.currentProfile.id === profile.id) {
    state.currentProfile = null;
    state.currentStream = null;
    showView("dashboard-view");
  }
  saveAppData(markAutoBackupDirty);
  refreshCurrentView();
  refreshListenerDetail();
};

export const openProfile = id => {
  state.currentProfile = state.profiles.find(p => p.id === id) || null;
  if (!state.currentProfile) return;
  // followerHistory が未定義の場合に空配列で初期化して安全化する
  if (!Array.isArray(state.currentProfile.followerHistory)) state.currentProfile.followerHistory = [];
  document.getElementById("profile-title").textContent = formatProfileLabel(state.currentProfile);
  if (_initLocalTabsFn) _initLocalTabsFn();
  renderStreams();
  renderFollowerHistory();
  switchLocalTab("streams");
  updateTabState('platform');
  showView("profile-detail-view");
};

export const renderStreams = () => {
  const list = document.getElementById("stream-list");
  list.innerHTML = "";
  if (!state.currentProfile) return;

  // 配信を日付・時刻の降順（新しい順）でソート
  let sortedStreams = [...state.currentProfile.streams].sort((a, b) => {
    const dateA = a.date || "";
    const dateB = b.date || "";
    const timeA = a.startTime || "";
    const timeB = b.startTime || "";
    const datetimeA = `${dateA} ${timeA}`;
    const datetimeB = `${dateB} ${timeB}`;
    return datetimeB.localeCompare(datetimeA);
  });

  // 検索フィルタ適用
  if (state.streamSearchQuery.trim()) {
    const query = state.streamSearchQuery.trim().toLowerCase();
    sortedStreams = sortedStreams.filter(stream => {
      const title = (stream.title || "").toLowerCase();
      return title.includes(query);
    });
  }

  // 検索結果が0件の場合
  if (sortedStreams.length === 0 && state.streamSearchQuery.trim()) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "empty-state";
    emptyLi.textContent = "該当する配信が見つかりません";
    list.appendChild(emptyLi);
    return;
  }

  sortedStreams.forEach(stream => {
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "list-item-header";

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = (stream.title || "無題の配信").trim() || "無題の配信";
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    actions.appendChild(createActionButton("編集", "edit", () => openStreamEditor(stream)));
    actions.appendChild(createActionButton("削除", "danger", () => confirmDeleteStream(stream)));
    header.appendChild(actions);

    li.appendChild(header);
    const schedule = document.createElement("div");
    schedule.className = "list-sub";
    schedule.textContent = `日時: ${formatStreamSchedule(stream)}`;
    li.appendChild(schedule);

    if (stream.url) {
      const urlLine = document.createElement("div");
      urlLine.className = "list-sub";
      urlLine.textContent = `URL: ${stream.url}`;
      li.appendChild(urlLine);
    }
    li.onclick = () => openStream(stream.id);
    list.appendChild(li);
  });
};

export const renderFollowerHistory = () => {
  if (!state.currentProfile) return;

  // サマリー計算（followerHistory が未定義の場合は空配列にフォールバック）
  const history = [...(Array.isArray(state.currentProfile.followerHistory) ? state.currentProfile.followerHistory : [])].sort((a, b) => b.date.localeCompare(a.date));
  const currentCountEl = document.getElementById("current-follower-count");
  const diffEl = document.getElementById("follower-diff");

  if (history.length > 0) {
    const latest = history[0];
    currentCountEl.textContent = latest.count.toLocaleString();

    if (history.length > 1) {
      const previous = history[1];
      const diff = latest.count - previous.count;
      diffEl.textContent = (diff >= 0 ? "+" : "") + diff.toLocaleString();
      diffEl.className = "summary-value " + (diff >= 0 ? "positive" : "negative");
    } else {
      diffEl.textContent = "-";
      diffEl.className = "summary-value";
    }
  } else {
    currentCountEl.textContent = "-";
    diffEl.textContent = "-";
    diffEl.className = "summary-value";
  }

  // 履歴リスト
  const list = document.getElementById("follower-history-list");
  list.innerHTML = "";
  history.forEach(entry => {
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "list-item-header";

    const date = document.createElement("span");
    date.className = "list-title";
    date.textContent = entry.date;
    header.appendChild(date);

    const count = document.createElement("span");
    count.className = "list-sub";
    count.textContent = `登録者数: ${entry.count.toLocaleString()}`;
    header.appendChild(count);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    actions.appendChild(createActionButton("編集", "edit", () => openFollowerHistoryEditor(entry)));
    actions.appendChild(createActionButton("削除", "danger", () => confirmDeleteFollowerHistory(entry)));
    header.appendChild(actions);

    li.appendChild(header);

    if (entry.note) {
      const note = document.createElement("div");
      note.className = "list-sub";
      note.textContent = `メモ: ${entry.note}`;
      li.appendChild(note);
    }

    list.appendChild(li);
  });
};

export const openFollowerHistoryEditor = entry => {
  const isEdit = !!entry;
  openModal(isEdit ? "履歴編集" : "履歴記録", [
    { name: "date", label: "記録日", type: "date", value: entry ? entry.date : formatDateInputValue(new Date()) },
    { name: "count", label: "登録者数", type: "number", value: entry ? entry.count : "", min: 0, inputmode: "numeric", step: 1 },
    { name: "note", label: "メモ（任意）", type: "textarea", value: entry ? entry.note : "" }
  ], values => {
    const date = sanitizeDateInput(values.date);
    const count = parseInt(values.count, 10);
    const note = (values.note || "").trim();

    if (!date) {
      alert("記録日を入力してください。");
      return;
    }
    if (Number.isNaN(count) || count < 0 || !Number.isInteger(count)) {
      alert("登録者数は0以上の整数を入力してください。");
      return;
    }

    // 同じ日付の重複チェック（編集時は自分自身を除外）
    const fh = Array.isArray(state.currentProfile.followerHistory) ? state.currentProfile.followerHistory : [];
    const duplicateEntry = fh.find(e => e.date === date && (!isEdit || e.id !== entry.id));
    if (duplicateEntry) {
      const proceed = confirm(`${date} には既に履歴が記録されています。\n上書きしますか？`);
      if (!proceed) return;
      // 既存の重複エントリを削除
      state.currentProfile.followerHistory = fh.filter(e => e.id !== duplicateEntry.id);
    }

    if (isEdit) {
      entry.date = date;
      entry.count = count;
      entry.note = note;
    } else {
      const newEntry = { id: generateId("fh"), date, count, note };
      if (!Array.isArray(state.currentProfile.followerHistory)) state.currentProfile.followerHistory = [];
      state.currentProfile.followerHistory.push(newEntry);
    }

    saveAppData(markAutoBackupDirty);
    renderFollowerHistory();
    closeModal();
  });
};

const confirmDeleteFollowerHistory = entry => {
  if (!entry || !state.currentProfile) return;
  const ok = confirm(`「${entry.date}」の記録を削除しますか？`);
  if (!ok) return;
  state.currentProfile.followerHistory = (state.currentProfile.followerHistory || []).filter(e => e.id !== entry.id);
  saveAppData(markAutoBackupDirty);
  renderFollowerHistory();
};

const openStreamEditor = stream => {
  openModal("配信編集", [
    { name: "title", label: "タイトル", value: stream.title || "" },
    { name: "date", label: "配信日", type: "date", value: stream.date || "" },
    { name: "startTime", label: "開始時刻（任意）", type: "time", value: stream.startTime || "" },
    {
      name: "url",
      label: "配信 URL（任意）",
      type: "url",
      value: stream.url || "",
      placeholder: "https://example.com"
    }
  ], values => {
    stream.title = (values.title || "").trim();
    stream.date = sanitizeDateInput(values.date);
    stream.startTime = sanitizeTimeInput(values.startTime);
    stream.url = sanitizeUrlInput(values.url);
    renderStreams();
    if (state.currentStream && state.currentStream.id === stream.id) {
      state.currentStream.title = stream.title;
      state.currentStream.date = stream.date;
      state.currentStream.startTime = stream.startTime;
      state.currentStream.url = stream.url;
      document.getElementById("stream-title").textContent = state.currentStream.title || "無題の配信";
      document.getElementById("stream-schedule").textContent = formatStreamSchedule(state.currentStream);
      updateStreamUrlLink(state.currentStream);
    }
    refreshCurrentView();
    refreshListenerDetail();
  });
};

const confirmDeleteStream = stream => {
  if (!confirm(`${formatStreamSchedule(stream)} ${stream.title} を削除します。参加者とギフトの記録も失われます。よろしいですか？`)) return;
  if (!state.currentProfile) return;
  state.currentProfile.streams = state.currentProfile.streams.filter(s => s.id !== stream.id);
  if (state.currentStream && state.currentStream.id === stream.id) {
    state.currentStream = null;
    showView("profile-detail-view");
  }
  saveAppData(markAutoBackupDirty);
  renderStreams();
  refreshCurrentView();
  refreshListenerDetail();
};
