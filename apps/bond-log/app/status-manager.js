// BondLog ステータスカタログ管理 UI モジュール
// ステータスの定義・編集・アーカイブ・削除を管理する

import { generateId, nameCollator } from "./utils.js";
import { state } from "./state.js";
import { saveAppData } from "./storage.js";
import { markAutoBackupDirty } from "./auto-backup.js";
import { openModal } from "./modal.js";
import {
  showView, refreshCurrentView, updateTabState, createActionButton
} from "./navigation.js";
// 循環依存あり: listener.js, stream-events.js（ランタイム参照のみ、モジュール評価時には使用しない）
import { refreshListenerDetail } from "./listener.js";
import { renderAttendees } from "./stream-events.js";

// --- ローカル状態 ---
export const statusManagerState = {
  selectedId: null,
  stateFilter: "active",
  formDirty: false,
  editingMode: "none",
  draft: null
};
export const statusManagerRefs = {};
export let statusFormSyncing = false;

// ステータスIDを衝突しないよう自動採番するユーティリティ
const generateUniqueStatusId = () => {
  let candidate = "";
  do {
    candidate = generateId("status_");
  } while (
    state.statusCatalog.some(status => status && status.id === candidate) ||
    (statusManagerState.draft && statusManagerState.draft.id === candidate)
  );
  return candidate;
};

const createInitialStatusDraft = (overrides = {}) => ({
  id: generateUniqueStatusId(),
  displayName: "",
  description: "",
  displayPriority: 0,
  isArchived: false,
  ...overrides
});

export const countStatusAssignments = statusId => {
  if (!statusId) return 0;
  let count = 0;
  state.listeners.forEach(listener => {
    if (!listener || !Array.isArray(listener.statusAssignments)) return;
    listener.statusAssignments.forEach(assignment => {
      if (assignment && assignment.statusId === statusId) count += 1;
    });
  });
  return count;
};

export const hasUnsavedStatusChanges = () => statusManagerState.formDirty || statusManagerState.editingMode === "draft";

export const confirmStatusDiscard = () => {
  if (!hasUnsavedStatusChanges()) return true;
  return confirm("未保存の変更があります。破棄しますか？");
};

export const setStatusFormActive = isActive => {
  if (!statusManagerRefs.form || !statusManagerRefs.detailEmptyMessage) return;
  if (isActive) {
    statusManagerRefs.form.classList.add("active");
    statusManagerRefs.detailEmptyMessage.style.display = "none";
  } else {
    statusManagerRefs.form.classList.remove("active");
    statusManagerRefs.detailEmptyMessage.style.display = "block";
  }
};

const getEditingStatus = () => {
  if (statusManagerState.editingMode === "draft" && statusManagerState.draft) return statusManagerState.draft;
  if (statusManagerState.editingMode === "existing") {
    return state.statusCatalog.find(status => status.id === statusManagerState.selectedId) || null;
  }
  return null;
};

export const updateStatusArchiveToggleLabel = () => {
  if (!statusManagerRefs.archiveToggle) return;
  const currentStatus = state.statusCatalog.find(s => s.id === statusManagerState.selectedId);
  const isArchived = currentStatus ? Boolean(currentStatus.isArchived) : false;
  statusManagerRefs.archiveToggle.textContent = isArchived ? "アクティブに戻す" : "アーカイブへ移動";
};

const updateStatusUsageInfo = (status, { isDraft } = {}) => {
  if (!statusManagerRefs.usageInfo) return;
  if (isDraft) {
    statusManagerRefs.usageInfo.textContent = "保存後に付与状況を確認できます";
    return;
  }
  if (!status) {
    statusManagerRefs.usageInfo.textContent = "";
    return;
  }
  const currentCount = countStatusAssignments(status.id);
  statusManagerRefs.usageInfo.textContent = currentCount > 0
    ? `現在の付与数: ${currentCount} 件`
    : "現在付与中のリスナーはいません";
};

export const populateStatusForm = (status, { isDraft } = {}) => {
  if (!statusManagerRefs.form) return;
  statusFormSyncing = true;
  if (statusManagerRefs.id) statusManagerRefs.id.value = status.id || "";
  statusManagerRefs.displayName.value = status.displayName || "";
  statusManagerRefs.description.value = status.description || "";
  statusManagerRefs.displayPriority.value = Number.isFinite(status.displayPriority) ? status.displayPriority : 0;
  updateStatusArchiveToggleLabel();
  updateStatusUsageInfo(status, { isDraft: Boolean(isDraft) });
  statusFormSyncing = false;
  statusManagerState.formDirty = false;
  setStatusFormActive(true);
  if (statusManagerRefs.deleteBtn) statusManagerRefs.deleteBtn.disabled = statusManagerState.editingMode !== "existing";
};

export const syncDraftFromForm = () => {
  if (statusManagerState.editingMode !== "draft" || !statusManagerState.draft) return;
  if (statusManagerRefs.displayName) {
    statusManagerState.draft.displayName = statusManagerRefs.displayName.value.trim();
  }
  if (statusManagerRefs.displayPriority) {
    const parsed = Number.parseInt(statusManagerRefs.displayPriority.value, 10);
    statusManagerState.draft.displayPriority = Number.isFinite(parsed) ? parsed : 0;
  }
};

export const renderStatusList = () => {
  if (!statusManagerRefs.list) return;
  const filtered = state.statusCatalog.filter(status => {
    if (!status) return false;
    const isArchived = Boolean(status.isArchived);
    if (statusManagerState.stateFilter === "active" && isArchived) return false;
    if (statusManagerState.stateFilter === "archived" && !isArchived) return false;
    return true;
  });
  const items = [...filtered];
  if (statusManagerState.editingMode === "draft" && statusManagerState.draft) {
    const draftEntry = { ...statusManagerState.draft, __draft: true };
    items.unshift(draftEntry);
  }
  items.sort((a, b) => {
    if (a.__draft) return -1;
    if (b.__draft) return 1;
    const priorityDiff = (b.displayPriority || 0) - (a.displayPriority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return nameCollator.compare((a.displayName || a.id || "").trim(), (b.displayName || b.id || "").trim());
  });
  statusManagerRefs.list.innerHTML = "";
  if (!items.length) {
    if (statusManagerRefs.emptyMessage) {
      statusManagerRefs.emptyMessage.textContent = state.statusCatalog.length
        ? "条件に一致するステータスがありません"
        : "ステータスが登録されていません";
      statusManagerRefs.emptyMessage.style.display = "block";
    }
    return;
  }
  if (statusManagerRefs.emptyMessage) statusManagerRefs.emptyMessage.style.display = "none";
  items.forEach(status => {
    const li = document.createElement("li");
    li.className = "status-list-item";
    if (status.__draft) li.classList.add("status-list-item--draft");
    const title = document.createElement("span");
    title.className = "status-list-title";
    title.textContent = status.displayName || "(名称未設定)";
    li.appendChild(title);
    const meta = document.createElement("div");
    meta.className = "status-list-meta";
    const prioritySpan = document.createElement("span");
    prioritySpan.textContent = `優先度: ${Number.isFinite(status.displayPriority) ? status.displayPriority : 0}`;
    meta.appendChild(prioritySpan);
    if (status.__draft) {
      const stateSpan = document.createElement("span");
      stateSpan.className = "status-list-state";
      stateSpan.textContent = "新規（未保存）";
      meta.appendChild(stateSpan);
    } else if (status.isArchived) {
      const stateSpan = document.createElement("span");
      stateSpan.className = "status-list-state";
      stateSpan.textContent = "アーカイブ";
      meta.appendChild(stateSpan);
    }
    li.appendChild(meta);
    if (!status.__draft) {
      li.onclick = () => {
        showStatusDetail(status.id);
      };
    }
    statusManagerRefs.list.appendChild(li);
  });
};

export const resetStatusManager = () => {
  statusManagerState.selectedId = null;
  statusManagerState.stateFilter = "active";
  statusManagerState.formDirty = false;
  statusManagerState.editingMode = "none";
  statusManagerState.draft = null;
  if (statusManagerRefs.deleteBtn) statusManagerRefs.deleteBtn.disabled = true;
  if (statusManagerRefs.usageInfo) statusManagerRefs.usageInfo.textContent = "";
  updateStatusArchiveToggleLabel();
};

export const beginCreateStatus = () => {
  const fields = [
    { name: "displayName", label: "表示名（必須）" },
    { name: "description", label: "説明（任意）", type: "textarea" },
    { name: "displayPriority", label: "優先度（任意）", type: "number", value: 0 }
  ];
  openModal("ステータスを追加", fields, values => {
    const displayName = (values.displayName || "").trim();
    if (!displayName) {
      alert("表示名を入力してください");
      return;
    }
    const newStatus = {
      id: generateUniqueStatusId(),
      displayName,
      description: values.description || "",
      displayPriority: Number(values.displayPriority) || 0,
      isArchived: false
    };
    state.statusCatalog.push(newStatus);
    saveAppData(markAutoBackupDirty);
    renderStatusList();
  });
};

const collectStatusFormValues = () => {
  if (!statusManagerRefs.form) return null;
  let resolvedId = "";
  if (statusManagerState.editingMode === "existing" && statusManagerState.selectedId) {
    resolvedId = statusManagerState.selectedId;
  } else if (statusManagerState.editingMode === "draft" && statusManagerState.draft && statusManagerState.draft.id) {
    resolvedId = statusManagerState.draft.id;
  } else if (statusManagerRefs.id && statusManagerRefs.id.value) {
    resolvedId = statusManagerRefs.id.value.trim();
  }
  if (!resolvedId) {
    resolvedId = generateUniqueStatusId();
    if (statusManagerRefs.id) statusManagerRefs.id.value = resolvedId;
    if (statusManagerState.editingMode === "draft" && statusManagerState.draft) {
      statusManagerState.draft.id = resolvedId;
      statusManagerState.selectedId = resolvedId;
    }
  }
  const displayNameRaw = statusManagerRefs.displayName.value.trim();
  if (!displayNameRaw) {
    alert("表示名を入力してください");
    return null;
  }
  const priorityRaw = Number.parseInt(statusManagerRefs.displayPriority.value, 10);
  const priorityValue = Number.isFinite(priorityRaw) ? priorityRaw : 0;
  const currentStatus = state.statusCatalog.find(s => s.id === resolvedId);
  const isArchived = currentStatus ? Boolean(currentStatus.isArchived) : false;
  return {
    id: resolvedId,
    displayName: displayNameRaw,
    description: statusManagerRefs.description.value.trim(),
    displayPriority: priorityValue,
    isArchived: isArchived
  };
};

export const applyStatusFormSave = () => {
  const payload = collectStatusFormValues();
  if (!payload) return;
  if (statusManagerState.editingMode === "draft") {
    if (state.statusCatalog.some(status => status.id === payload.id)) {
      alert("同じステータスが既に存在します");
      return;
    }
    state.statusCatalog.push(payload);
    statusManagerState.selectedId = payload.id;
    statusManagerState.editingMode = "existing";
    statusManagerState.draft = null;
  } else if (statusManagerState.editingMode === "existing") {
    const originalId = statusManagerState.selectedId;
    if (payload.id !== originalId && state.statusCatalog.some(status => status.id === payload.id)) {
      alert("同じステータスが既に存在します");
      return;
    }
    const index = state.statusCatalog.findIndex(status => status.id === originalId);
    if (index >= 0) {
      state.statusCatalog[index] = payload;
    } else {
      state.statusCatalog.push(payload);
    }
    if (originalId && originalId !== payload.id) {
      state.listeners.forEach(listener => {
        if (!listener || !Array.isArray(listener.statusAssignments)) return;
        listener.statusAssignments.forEach(assignment => {
          if (assignment && assignment.statusId === originalId) assignment.statusId = payload.id;
        });
      });
    }
    statusManagerState.selectedId = payload.id;
  } else {
    return;
  }
  statusManagerState.formDirty = false;
  saveAppData(markAutoBackupDirty);
  populateStatusForm(payload, { isDraft: false });
  backToStatusList();
  refreshCurrentView();
  refreshListenerDetail();
  renderAttendees();
};

export const discardStatusChanges = () => {
  if (statusManagerState.editingMode === "draft") {
    statusManagerState.draft = createInitialStatusDraft();
    statusManagerState.selectedId = statusManagerState.draft.id;
    populateStatusForm(statusManagerState.draft, { isDraft: true });
    return;
  }
  if (statusManagerState.editingMode === "existing") {
    const status = state.statusCatalog.find(entry => entry.id === statusManagerState.selectedId);
    if (!status) {
      backToStatusList();
      return;
    }
    populateStatusForm(status, { isDraft: false });
  }
};

export const removeStatusDefinition = () => {
  if (statusManagerState.editingMode === "draft") {
    statusManagerState.draft = null;
    statusManagerState.editingMode = "none";
    statusManagerState.selectedId = null;
    statusManagerState.formDirty = false;
    setStatusFormActive(false);
    renderStatusList();
    return;
  }
  if (statusManagerState.editingMode !== "existing" || !statusManagerState.selectedId) return;
  const targetId = statusManagerState.selectedId;
  const targetStatus = state.statusCatalog.find(entry => entry.id === targetId) || null;
  const statusLabel = targetStatus && targetStatus.displayName
    ? targetStatus.displayName
    : "該当ステータス";
  const usageCount = countStatusAssignments(targetId);
  const message = usageCount > 0
    ? `${statusLabel} を削除すると、付与履歴 ${usageCount} 件も同時に削除されます。よろしいですか？`
    : `${statusLabel} を削除しますか？`;
  if (!confirm(message)) return;
  state.statusCatalog = state.statusCatalog.filter(status => status.id !== targetId);
  state.listeners.forEach(listener => {
    if (!listener || !Array.isArray(listener.statusAssignments)) return;
    listener.statusAssignments = listener.statusAssignments.filter(assignment => assignment && assignment.statusId !== targetId);
  });
  statusManagerState.selectedId = null;
  statusManagerState.editingMode = "none";
  statusManagerState.formDirty = false;
  setStatusFormActive(false);
  backToStatusList();
  saveAppData(markAutoBackupDirty);
  refreshCurrentView();
  refreshListenerDetail();
  renderAttendees();
};

const showStatusList = () => {
  resetStatusManager();
  if (statusManagerRefs.filterState) statusManagerRefs.filterState.value = statusManagerState.stateFilter;
  renderStatusList();
  showView("status-list-view");
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateTabState('status');
};

export const showStatusDetail = (statusId) => {
  const status = state.statusCatalog.find(s => s.id === statusId);
  if (!status) return;
  statusManagerState.selectedId = statusId;
  statusManagerState.editingMode = "existing";
  statusManagerState.draft = null;
  populateStatusForm(status, { isDraft: false });
  showView("status-detail-view");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

export const backToStatusList = () => {
  resetStatusManager();
  renderStatusList();
  showView("status-list-view");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

export const openStatusManagement = () => showStatusList();

export const closeStatusManagement = () => {
  resetStatusManager();
  renderStatusList();
};

export const isStatusViewActive = () => Boolean(statusManagerRefs.view && statusManagerRefs.view.classList.contains("active"));

export const maybeCloseStatusManagement = () => {
  if (!isStatusViewActive()) return true;
  if (hasUnsavedStatusChanges() && !confirmStatusDiscard()) return false;
  closeStatusManagement();
  return true;
};

export const requestOpenStatusManagement = () => {
  const menuElement = document.getElementById("menu");
  if (menuElement) menuElement.style.display = "none";
  const currentView = document.querySelector('.view.active');
  if (currentView && (currentView.id === 'status-list-view' || currentView.id === 'status-detail-view') && hasUnsavedStatusChanges()) {
    if (!confirmStatusDiscard()) return false;
  }
  openStatusManagement();
  return true;
};
