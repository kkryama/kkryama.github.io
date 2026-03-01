// BondLog メインモジュール
// UI を含むアプリケーション本体

// --- 基盤モジュール ---

import {
  generateId, formatDateInputValue,
  formatProfileLabel, parseTagsInput, normalizeListenerUrls,
  nameCollator
} from "./utils.js";

import {
  CURRENT_SCHEMA_VERSION, PLATFORM_CANDIDATES
} from "./constants.js";

import {
  sanitizeStream, normalizeData, createDefaultData, createDefaultGiftTemplates
} from "./sanitize.js";

import {
  state, getListenerById, getProfileListeners, linkListenerToProfile
} from "./state.js";

import {
  openDB, saveAppData, loadAppData, currentPayload
} from "./storage.js";

import {
  initAutoBackup, initAutoBackupCardCollapsible,
  markAutoBackupDirty, silenceNextDirty
} from "./auto-backup.js";

import { openModal, modalBody } from "./modal.js";

import {
  setChartDuration, renderFollowerCharts
} from "./chart.js";

import {
  showView, refreshCurrentView, registerViewRefresher,
  updateTabState, switchLocalTab, setCollapsibleState,
  initDashboardCollapsibles, initFooterSafeSpace
} from "./navigation.js";

// --- 機能モジュール ---

import {
  statusManagerState, statusManagerRefs, statusFormSyncing,
  beginCreateStatus, renderStatusList, confirmStatusDiscard,
  closeStatusManagement, backToStatusList, resetStatusManager,
  syncDraftFromForm, updateStatusArchiveToggleLabel,
  applyStatusFormSave, removeStatusDefinition,
  maybeCloseStatusManagement, requestOpenStatusManagement
} from "./status-manager.js";

import { renderDashboard } from "./dashboard.js";

import {
  renderPlatformList, renderStreams,
  openFollowerHistoryEditor, registerInitLocalTabs
} from "./platform.js";

import {
  renderListenerList, refreshListenerDetail,
  openListenerStatusManager, openListenerStatusHistory
} from "./listener.js";

import { renderAttendees, renderGifts } from "./stream-events.js";

// === イベント ===
const addPlatformBtn = document.getElementById("add-platform-btn");
if (addPlatformBtn) {
  addPlatformBtn.onclick = () => {
  openModal("プラットフォーム追加", [
    {
      name: "platform",
      label: "プラットフォーム名",
      type: "datalist",
      options: PLATFORM_CANDIDATES,
      placeholder: "直接入力するか候補から選んでください"
    },
    { name: "accountName", label: "アカウント名" },
    {
      name: "url",
      label: "プラットフォーム URL(任意)",
      type: "url",
      placeholder: "https://example.com"
    },
    {
      name: "note",
      label: "備考（任意）",
      type: "textarea"
    }
  ], v => {
    const newProfile = {
      id: generateId("p"),
      platform: (v.platform || "").trim(),
      accountName: (v.accountName || "").trim(),
      url: (v.url || "").trim().slice(0, 2048),
      note: (v.note || "").trim().slice(0, 1000),
      streams: [],
      followerHistory: []
    };
    state.profiles.push(newProfile);
    renderPlatformList();
  });
  };
}

document.getElementById("add-stream").onclick = () => {
  openModal("配信追加", [
    { name: "title", label: "タイトル" },
    { name: "date", label: "配信日", type: "date", value: formatDateInputValue(new Date()) },
    { name: "startTime", label: "開始時刻（任意）", type: "time" },
    {
      name: "url",
      label: "配信 URL（任意）",
      type: "url",
      placeholder: "https://example.com"
    }
  ], v => {
    // URL の簡易検証
    if (v.url && v.url.trim()) {
      try {
        // URL コンストラクタで検証（プロトコル必須）
        new URL(v.url);
      } catch (err) {
        alert('配信 URL が不正です。スキーム（https://）を含めた正しいURLを入力してください。');
        return;
      }
    }
    const newStream = sanitizeStream({
      id: generateId("s"),
      title: v.title,
      date: v.date,
      startTime: v.startTime,
      url: v.url,
      attendees: [],
      gifts: []
    });
    state.currentProfile.streams.push(newStream);
    renderStreams();
  });
};

const globalListenerSortSelect = document.getElementById("global-listener-sort");
if (globalListenerSortSelect) {
  globalListenerSortSelect.onchange = e => {
    state.listenerSortMode = e.target.value || "name-asc";
    renderDashboard();
  };
}

const listenerSortSelect = document.getElementById("listener-sort");
if (listenerSortSelect) {
  listenerSortSelect.onchange = e => {
    state.listenerSortMode = e.target.value || "name-asc";
    renderListenerList();
  };
}

const platformSortSelect = document.getElementById("platform-sort");
if (platformSortSelect) {
  platformSortSelect.onchange = e => {
    state.platformSortMode = e.target.value || "name-asc";
    renderPlatformList();
  };
}

const addListenerBtn = document.getElementById("add-listener-btn");
if (addListenerBtn) {
  addListenerBtn.onclick = () => {
    const profileOptions = state.profiles
      .map(profile => ({ value: profile.id, label: formatProfileLabel(profile) }))
      .sort((a, b) => nameCollator.compare(a.label || "", b.label || ""));
    const fields = [
      { name: "name", label: "リスナー名（必須）" },
      { name: "urls", label: "URL（改行区切り・最大5件）", type: "textarea" },
      { name: "tags", label: "タグ（カンマ区切り・最大10件）" },
      { name: "memo", label: "メモ（任意）", type: "textarea" }
    ];
    if (profileOptions.length) {
      fields.push({
          name: "profileIds",
        label: "関連付けるプラットフォーム（任意）",
        type: "checkboxes",
        options: profileOptions
      });
    }
    openModal("リスナー登録", fields, values => {
      const name = (values.name || "").trim();
      if (!name) {
        alert("リスナー名を入力してください");
        return;
      }
      const memo = values.memo ? values.memo.slice(0, 1000) : "";
      const linkedProfiles = Array.isArray(values.profileIds) ? values.profileIds : [];
      const newListener = {
        id: generateId("l"),
        name,
        tags: parseTagsInput(values.tags),
        memo,
        profileIds: linkedProfiles,
        urls: normalizeListenerUrls(values.urls),
        statusAssignments: []
      };
      state.listeners.push(newListener);
      renderListenerList();
    });
  };
}

document.getElementById("add-attendee").onclick = () => {
  const NEW_OPTION_VALUE = "__new_listener__";
  const attendeeIds = new Set(Array.isArray(state.currentStream && state.currentStream.attendees) ? state.currentStream.attendees : []);
  const listenerEntries = getProfileListeners(state.currentProfile.id)
    .filter(listener => listener && !attendeeIds.has(listener.id))
    .map(l => ({ id: l.id, name: l.name || "" }));
  const hasExisting = listenerEntries.length > 0;
  openModal("参加者追加", [
    {
      name: "showAllListeners",
      label: "他のプラットフォームのリスナーも表示",
      type: "checkbox",
      value: false
    },
    {
      name: "listenerSelect",
      label: "リスナーを選択",
      type: "select",
      options: hasExisting
        ? [...listenerEntries.map(entry => ({ value: entry.id, label: entry.name || "(名称未設定)" })), { value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを追加" }]
        : [{ value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを追加" }],
      onCreate: (element, wrapper) => {
        wrapper.dataset.field = "listenerSelect";
        const getAvailableCandidates = showAll => {
          const source = showAll ? state.listeners : getProfileListeners(state.currentProfile.id);
          return source.filter(listener => listener && !attendeeIds.has(listener.id));
        };
        const toggleInput = () => {
          const inputWrap = modalBody.querySelector('[data-field="listenerNew"]');
          if (!inputWrap) return;
          inputWrap.style.display = element.value === NEW_OPTION_VALUE ? "" : "none";
        };
        const checkbox = document.getElementById("showAllListeners");
        const rebuildOptions = () => {
          const showAll = checkbox ? checkbox.checked : false;
          const candidates = getAvailableCandidates(showAll);
          const previousValue = element.value;
          element.innerHTML = "";
          candidates
            .slice()
            .sort((a, b) => nameCollator.compare(a.name || "", b.name || ""))
            .forEach(listener => {
              const opt = document.createElement("option");
              opt.value = listener.id;
              opt.textContent = listener.name || "(名称未設定)";
              element.appendChild(opt);
            });
          const newOpt = document.createElement("option");
          newOpt.value = NEW_OPTION_VALUE;
          newOpt.textContent = "＋ 新規リスナーを追加";
          element.appendChild(newOpt);
          const optionValues = Array.from(element.options).map(opt => opt.value);
          if (previousValue && optionValues.includes(previousValue)) {
            element.value = previousValue;
          } else if (candidates.length > 0) {
            element.selectedIndex = 0;
          } else {
            element.value = NEW_OPTION_VALUE;
          }
          toggleInput();
        };
        element.addEventListener("change", toggleInput);
        if (checkbox) checkbox.addEventListener("change", rebuildOptions);
        rebuildOptions();
        toggleInput();
      }
    },
    {
      name: "listenerNew",
      label: "新規リスナー名",
      type: "text",
      placeholder: "新しいリスナー名を入力",
      hidden: hasExisting,
      onCreate: (_element, wrapper) => { wrapper.dataset.field = "listenerNew"; }
    }
  ], values => {
    const selectValue = values.listenerSelect;
    if (selectValue === NEW_OPTION_VALUE) {
      const newName = typeof values.listenerNew === "string" ? values.listenerNew.trim() : "";
      if (!newName) {
        alert("新規リスナー名を入力してください");
        return;
      }
      const newListener = {
        id: generateId("l"),
        name: newName,
        tags: [],
        memo: "",
        profileIds: [state.currentProfile.id],
        urls: [],
        statusAssignments: []
      };
      state.listeners.push(newListener);
      state.currentStream.attendees.push(newListener.id);
      refreshCurrentView();
      renderAttendees();
      return;
    }
    const selectedListener = getListenerById(selectValue);
    if (!selectedListener) return;
    linkListenerToProfile(selectedListener, state.currentProfile.id);
    state.currentStream.attendees.push(selectedListener.id);
    renderAttendees();
    refreshCurrentView();
  });
};

document.getElementById("add-gift").onclick = () => {
  if (!state.currentProfile) return;
  const profileListeners = getProfileListeners(state.currentProfile.id);
  if (!profileListeners.length) {
    alert("リスナーが登録されていません。先にリスナーを追加してください。");
    return;
  }
  const TEMPLATE_CREATE_VALUE = "__create_template__";
  const listenerOptions = profileListeners.map(l => ({ value: l.id, label: l.name || "(名称未設定)" }));
  const templateOptions = [
    { value: "", label: "テンプレートを使用しない" },
    ...state.giftTemplates.map(template => ({ value: template.id, label: template.name || template.item || "テンプレート" })),
    { value: TEMPLATE_CREATE_VALUE, label: "＋ テンプレートを新規追加" }
  ];
  openModal("ギフト追加", [
    { name: "listener", label: "リスナー選択", type: "select", options: listenerOptions },
    {
      name: "template",
      label: "ギフトテンプレート",
      type: "select",
      options: templateOptions,
      onCreate: (element, wrapper) => {
        wrapper.dataset.field = "giftTemplateSelect";
        // テンプレート選択によるフィールド反映をまとめる
        const applyTemplateValues = selectedId => {
          const nameWrap = modalBody.querySelector('[data-field="giftTemplateName"]');
          if (nameWrap) nameWrap.style.display = selectedId === TEMPLATE_CREATE_VALUE ? "" : "none";
          const itemInput = modalBody.querySelector('#giftItem');
          const amountInput = modalBody.querySelector('#giftAmount');
          if (selectedId && selectedId !== TEMPLATE_CREATE_VALUE) {
            const template = state.giftTemplates.find(t => t.id === selectedId);
            if (template) {
              if (itemInput) itemInput.value = template.item || "";
              if (amountInput) amountInput.value = template.amount || "";
            }
          }
          if (selectedId === TEMPLATE_CREATE_VALUE) {
            if (itemInput) itemInput.value = "";
            if (amountInput) amountInput.value = "";
          }
        };
        element.addEventListener("change", () => applyTemplateValues(element.value));
      }
    },
    {
      name: "templateName",
      label: "テンプレート名",
      hidden: true,
      onCreate: (_element, wrapper) => { wrapper.dataset.field = "giftTemplateName"; }
    },
    { name: "giftItem", label: "ギフト内容" },
    { name: "giftAmount", label: "金額やポイント" }
  ], values => {
    const listener = getListenerById(values.listener);
    if (!listener) {
      alert("リスナーを選択してください");
      return;
    }
    const chosenTemplate = values.template;
    const item = (values.giftItem || "").trim();
    const amount = (values.giftAmount || "").trim();
    if (!item) {
      alert("ギフト内容を入力してください");
      return;
    }
    if (chosenTemplate === TEMPLATE_CREATE_VALUE) {
      const templateNameRaw = (values.templateName || "").trim();
      const templateName = templateNameRaw || item;
      state.giftTemplates.push({
        id: generateId("gt"),
        name: templateName,
        item,
        amount
      });
      state.giftTemplates.sort((a, b) => nameCollator.compare(a.name || "", b.name || ""));
    }
    linkListenerToProfile(listener, state.currentProfile.id);
    state.currentStream.gifts.push({
      listenerId: listener.id,
      item,
      amount
    });
    renderGifts();
    refreshCurrentView();
    refreshListenerDetail();
  });
};

// === 戻る・メニュー ===
const navigateHome = () => {
  if (!maybeCloseStatusManagement()) return;
  saveAppData(markAutoBackupDirty);
  showView("dashboard-view");
  renderDashboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
  
  // タブ状態を更新
  updateTabState('dashboard');
};

document.getElementById("app-title").onclick = navigateHome;
document.getElementById("app-title").onkeydown = event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    navigateHome();
  }
};

document.getElementById("back-to-profiles").onclick = () => { saveAppData(markAutoBackupDirty); switchToTab('platform'); };
document.getElementById("back-to-profile").onclick = ()=>{ saveAppData(markAutoBackupDirty); showView("profile-detail-view"); renderStreams(); };
document.getElementById("back-to-listeners").onclick = () => { saveAppData(markAutoBackupDirty); switchToTab('listener');};

// 戻るボタン（プラットフォーム一覧→ダッシュボード）
document.getElementById("back-to-dashboard-from-platform").onclick = () => { saveAppData(markAutoBackupDirty); navigateHome(); };
document.getElementById("back-to-dashboard-from-listener").onclick = () => { saveAppData(markAutoBackupDirty); navigateHome(); };

// 「すべて見る」ボタン
document.getElementById("dashboard-view-all-platforms").onclick = () => switchToTab('platform');
document.getElementById("listener-edit").onclick = () => {
  if (!state.currentListener) return;
  const urlsValue = Array.isArray(state.currentListener.urls) ? state.currentListener.urls.join("\n") : "";
  openModal("リスナー情報編集", [
    {
      name: "targetInfo",
      label: "編集対象",
      type: "static",
      value: state.currentListener.name || "(名称未設定)"
    },
    {
      name: "name",
      label: "リスナー名（必須）",
      value: state.currentListener.name || ""
    },
    {
      name: "urls",
      label: "URL（改行区切り・最大5件）",
      type: "textarea",
      value: urlsValue
    },
    {
      name: "tags",
      label: "タグ（カンマ区切り・最大10件）",
      value: Array.isArray(state.currentListener.tags) ? state.currentListener.tags.join(", ") : ""
    },
    {
      name: "profileIds",
  label: "所属プラットフォーム（複数選択可）",
      type: "checkboxes",
      options: state.profiles
        .map(profile => ({ value: profile.id, label: formatProfileLabel(profile) }))
        .sort((a, b) => nameCollator.compare(a.label || "", b.label || "")),
      value: Array.isArray(state.currentListener.profileIds) ? [...state.currentListener.profileIds] : []
    },
    {
      name: "memo",
      label: "メモ（最大1000文字）",
      type: "textarea",
      value: state.currentListener.memo || ""
    }
  ], values => {
    const name = (values.name || "").trim();
    if (!name) {
      alert("リスナー名を入力してください");
      return;
    }
    const memo = values.memo ? values.memo.slice(0, 1000) : "";
    const selectedProfiles = Array.isArray(values.profileIds) ? values.profileIds : [];
    state.currentListener.name = name;
    state.currentListener.urls = normalizeListenerUrls(values.urls);
    state.currentListener.tags = parseTagsInput(values.tags);
    state.currentListener.memo = memo;
    state.currentListener.profileIds = selectedProfiles;
    refreshListenerDetail();
    refreshCurrentView();
  });
};

const listenerStatusManageBtn = document.getElementById("listener-status-manage");
if (listenerStatusManageBtn) {
  listenerStatusManageBtn.onclick = () => openListenerStatusManager();
}

const listenerStatusHistoryBtn = document.getElementById("listener-status-history");
if (listenerStatusHistoryBtn) {
  listenerStatusHistoryBtn.onclick = () => openListenerStatusHistory();
}

// === メニュー ===
statusManagerRefs.listView = document.getElementById("status-list-view");
statusManagerRefs.detailView = document.getElementById("status-detail-view");
if (statusManagerRefs.listView) {
  statusManagerRefs.list = document.getElementById("status-list");
  statusManagerRefs.emptyMessage = document.getElementById("status-empty");
  statusManagerRefs.addBtn = document.getElementById("status-add-btn");
  statusManagerRefs.filterState = document.getElementById("status-filter-state");
  statusManagerRefs.backToDashboardBtn = document.getElementById("back-to-dashboard-from-status");

  if (statusManagerRefs.addBtn) statusManagerRefs.addBtn.onclick = () => beginCreateStatus();
  if (statusManagerRefs.filterState) statusManagerRefs.filterState.onchange = event => {
    statusManagerState.stateFilter = event.target.value || "active";
    renderStatusList();
  };
  if (statusManagerRefs.backToDashboardBtn) statusManagerRefs.backToDashboardBtn.onclick = () => {
    if (!confirmStatusDiscard()) return;
    closeStatusManagement();
    navigateHome();
  };
}
if (statusManagerRefs.detailView) {
  statusManagerRefs.detailEmptyMessage = document.getElementById("status-detail-empty");
  statusManagerRefs.form = document.getElementById("status-editor-form");
  statusManagerRefs.id = document.getElementById("status-id");
  statusManagerRefs.displayName = document.getElementById("status-displayName");
  statusManagerRefs.description = document.getElementById("status-description");
  statusManagerRefs.displayPriority = document.getElementById("status-displayPriority");
  statusManagerRefs.archiveToggle = document.getElementById("status-archive-toggle-btn");
  statusManagerRefs.deleteBtn = document.getElementById("status-delete-btn");
  statusManagerRefs.saveBtn = document.getElementById("status-save-btn");
  statusManagerRefs.usageInfo = document.getElementById("status-usage-info");
  statusManagerRefs.backToListBtn = document.getElementById("back-to-status-list");
}

if (statusManagerRefs.detailView) {
  const handleFormChange = () => {
    if (statusFormSyncing) return;
    statusManagerState.formDirty = true;
    syncDraftFromForm();
    updateStatusArchiveToggleLabel();
    // Note: No renderStatusList here since we're in detail view
  };

  if (statusManagerRefs.form) {
    statusManagerRefs.form.addEventListener("submit", event => {
      event.preventDefault();
      applyStatusFormSave();
    });
    statusManagerRefs.form.addEventListener("input", handleFormChange);
    statusManagerRefs.form.addEventListener("change", handleFormChange);
  }

  if (statusManagerRefs.archiveToggle) {
    statusManagerRefs.archiveToggle.onclick = () => {
      // 現在編集中のステータスを取得
      const currentStatus = state.statusCatalog.find(s => s.id === statusManagerState.selectedId);
      if (!currentStatus && statusManagerState.editingMode !== "draft") {
        return;
      }
      
      // 現在のアーカイブ状態を確認
      const isCurrentlyArchived = currentStatus ? Boolean(currentStatus.isArchived) : false;
      const willBeArchived = !isCurrentlyArchived;
      
      const confirmMessage = willBeArchived
        ? "このステータスをアーカイブしますか?\n\n編集中の内容も保存されます。"
        : "このステータスをアクティブに戻しますか?\n\n編集中の内容も保存されます。";
      
      // 確認ダイアログを表示
      if (!confirm(confirmMessage)) {
        return;
      }
      
      // ステータスのアーカイブ状態を直接変更
      if (currentStatus) {
        currentStatus.isArchived = willBeArchived;
      }
      
      // データを保存
      saveAppData(markAutoBackupDirty);
      
      // 一覧画面へ戻る
      backToStatusList();
      // アーカイブ操作後は、変更したステータスが表示されるフィルターに切り替える
      // (backToStatusList内でresetStatusManagerが呼ばれるため、その後に設定)
      statusManagerState.stateFilter = willBeArchived ? "archived" : "active";
      if (statusManagerRefs.filterState) {
        statusManagerRefs.filterState.value = statusManagerState.stateFilter;
      }
      renderStatusList(); // フィルター変更を反映
      refreshCurrentView();
      refreshListenerDetail();
      renderAttendees();
    };
  }

  if (statusManagerRefs.deleteBtn) statusManagerRefs.deleteBtn.onclick = () => removeStatusDefinition();
  if (statusManagerRefs.backToListBtn) statusManagerRefs.backToListBtn.onclick = () => {
    if (!confirmStatusDiscard()) return;
    backToStatusList();
  };

  resetStatusManager();
  renderStatusList();
}

function applyNormalizedPayload(rawPayload, { persist = true, suppressAutoBackup = false } = {}) {
  const normalized = normalizeData(rawPayload);
  state.profiles = normalized.profiles;
  state.listeners = normalized.listeners;
  state.statusCatalog = Array.isArray(normalized.statusCatalog) ? normalized.statusCatalog : [];
  state.schemaVersion = Number.isFinite(normalized.schemaVersion) ? normalized.schemaVersion : CURRENT_SCHEMA_VERSION;
  state.giftTemplates = Array.isArray(normalized.giftTemplates) ? normalized.giftTemplates : createDefaultGiftTemplates();
  state.currentProfile = null;
  state.currentStream = null;
  state.currentListener = null;
  renderStatusList();
  if (persist) {
    if (suppressAutoBackup) silenceNextDirty();
    saveAppData(markAutoBackupDirty);
  }
  renderDashboard();
  showView("dashboard-view");
}

const menu=document.getElementById("menu"), menuBtn=document.getElementById("menu-button");
menuBtn.onclick=()=>{menu.style.display=menu.style.display==="block"?"none":"block";};
document.body.onclick=e=>{if(!menu.contains(e.target)&&e.target!==menuBtn)menu.style.display="none";};

document.getElementById("export-btn").onclick=()=>{
  const payload={...currentPayload(),schemaVersion:CURRENT_SCHEMA_VERSION};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`bondlog_${new Date().toISOString().slice(0,10)}.json`;
  a.click();menu.style.display="none";
};

document.getElementById("import-btn").onclick=()=>{
  const input=document.createElement("input");
  input.type="file";input.accept="application/json";
  input.onchange=e=>{
    const file=e.target.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        if (!reader.result || !reader.result.trim()) {
          alert("ファイルが空です");
          return;
        }
        const parsed=JSON.parse(reader.result);
        applyNormalizedPayload(parsed);
        alert("インポート完了");
      }catch(err){
        console.error(err);
        alert("インポートに失敗しました。JSON ファイルを確認してください。");
      }
    };
    reader.readAsText(file);
  };
  input.click();menu.style.display="none";
};

document.getElementById("reset-btn").onclick=()=>{
  if(!confirm("保存されているデータをすべて削除し、初期状態に戻します。よろしいですか？")) return;
  const defaults=createDefaultData();
  applyNormalizedPayload(defaults);
  menu.style.display="none";
  alert("データを初期化しました");
};

// === 起動 ===
openDB().then(async()=>{
  const loaded=await loadAppData();
  state.profiles=loaded.profiles;
  state.listeners=loaded.listeners;
  state.statusCatalog=Array.isArray(loaded.statusCatalog)?loaded.statusCatalog:[];
  state.schemaVersion=Number.isFinite(loaded.schemaVersion)?loaded.schemaVersion:CURRENT_SCHEMA_VERSION;
  state.giftTemplates=Array.isArray(loaded.giftTemplates)?loaded.giftTemplates:createDefaultGiftTemplates();
  if(state.profiles.length===0&&state.listeners.length===0){
    const defaults=createDefaultData();
    state.profiles=defaults.profiles;
    state.listeners=defaults.listeners;
    state.statusCatalog=defaults.statusCatalog;
    state.giftTemplates=defaults.giftTemplates;
    state.schemaVersion=defaults.schemaVersion;
    saveAppData(markAutoBackupDirty);
  }
  // ビューリフレッシャー登録
  registerViewRefresher("dashboard-view", renderDashboard);
  registerViewRefresher("platform-list-view", renderPlatformList);
  registerViewRefresher("listener-list-view", renderListenerList);
  registerViewRefresher("listener-detail-view", () => {
    if (state.currentListener) refreshListenerDetail();
  });
  renderDashboard();
  initTabNavigation();
  registerInitLocalTabs(initLocalTabs);
  initLocalTabs();
  await initAutoBackup(applyNormalizedPayload);

  // --- グラフ機能用イベントリスナー ---

  // 期間変更イベントリスナー
  const durationFilter = document.getElementById('chart-duration-filter');
  if (durationFilter) {
    durationFilter.addEventListener('change', () => {
      setChartDuration(durationFilter.value);
      renderFollowerCharts(state.profiles);
    });
  }

  // ダッシュボードタブクリックイベントリスナー（タブ切り替え時の再描画）
  const dashboardTab = document.querySelector('.tab-btn[data-page-target="dashboard"]');
  if (dashboardTab) {
    dashboardTab.addEventListener('click', () => {
      // 遅延実行でグラフを描画
      setTimeout(() => renderFollowerCharts(state.profiles), 100);
    });
  }

  // ヒーローセクション開閉機能
  const toggleHeroBtn = document.getElementById('toggle-hero');
  const heroSection = document.querySelector('.home-hero');
  if (toggleHeroBtn && heroSection) {
    // ローカルストレージから状態を読み込み
    const isCollapsed = localStorage.getItem('heroCollapsed') === 'true';
    if (isCollapsed) {
      heroSection.classList.add('collapsed');
    }

    toggleHeroBtn.addEventListener('click', () => {
      heroSection.classList.toggle('collapsed');
      const collapsed = heroSection.classList.contains('collapsed');
      localStorage.setItem('heroCollapsed', collapsed);
    });
  }

  initDashboardCollapsibles();
  initAutoBackupCardCollapsible(setCollapsibleState);
  initFooterSafeSpace();

  // 初回データロード後の描画処理（遅延実行）
  setTimeout(() => renderFollowerCharts(state.profiles), 100);
});

// タブナビゲーション機能
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-page-target');
      switchToTab(target);
    });
  });
}

function initLocalTabs() {
  const localTabButtons = document.querySelectorAll('.local-tab-btn');
  localTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      switchLocalTab(target);
    });
  });

  // 登録者履歴追加ボタン
  const addButton = document.getElementById('add-follower-history');
  if (addButton) {
    addButton.addEventListener('click', () => openFollowerHistoryEditor(null));
  }

  // 配信検索input
  const streamSearchInput = document.getElementById('stream-search');
  if (streamSearchInput) {
    streamSearchInput.addEventListener('input', (e) => {
      state.streamSearchQuery = e.target.value;
      renderStreams();
    });
  }
}

function handleTabNavigation(target) {
  switch(target) {
    case 'dashboard':
      navigateHome();
      return true;
    case 'platform':
      if (!maybeCloseStatusManagement()) return false;
      showView('platform-list-view');
      renderPlatformList();
      return true;
    case 'listener':
      if (!maybeCloseStatusManagement()) return false;
      showView('listener-list-view');
      renderListenerList();
      return true;
    case 'status':
      return requestOpenStatusManagement();
    default:
      return false;
  }
}

function switchToTab(target) {
  const prevTarget = document.querySelector('.tab-btn.active')?.getAttribute('data-page-target') || 'dashboard';
  const switched = handleTabNavigation(target);
  if (switched) {
    updateTabState(target);
  } else {
    updateTabState(prevTarget);
  }
}

