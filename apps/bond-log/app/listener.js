// BondLog リスナー管理モジュール
// リスナー一覧、リスナー詳細、ステータス付与・履歴の描画・操作を管理する

import {
  formatDateInputValue, formatTimeInputValue,
  buildIsoDateTime, formatDateTimeLocalValue, buildIsoFromDateTimeLocal,
  parseIsoDateTime, formatDateTimeForDisplay,
  formatStreamSchedule, formatProfileLabel,
  parseGiftAmount, parseStreamDate, nameCollator
} from "./utils.js";
import { state, getListenerById } from "./state.js";
import { saveAppData } from "./storage.js";
import { markAutoBackupDirty } from "./auto-backup.js";
import {
  openModal, closeModal, modalBg, modalTitle, modalBody, modalHeaderActions
} from "./modal.js";
import {
  getStatusDefinitionById, getActiveStatusEntries,
  findActiveStatusAssignment, populateStatusContainer
} from "./status-badge.js";
import {
  showView, refreshCurrentView, updateTabState
} from "./navigation.js";
import { buildLatestAttendanceMapAll } from "./top-listener.js";
// 循環依存あり: stream-events.js（ランタイム参照のみ、モジュール評価時には使用しない）
import { openStream, renderAttendees } from "./stream-events.js";

export const renderListenerList = () => {
  const list = document.getElementById("listener-list");
  const emptyMessage = document.getElementById("listener-empty");
  if (!list || !emptyMessage) return;

  // ステータスフィルタオプションを初期化
  initializeListenerStatusFilter();

  list.innerHTML = "";
  const latestAttendanceMap = buildLatestAttendanceMapAll();
  const sortSelect = document.getElementById("listener-sort");
  if (sortSelect) sortSelect.value = state.listenerSortMode;
  const compareNameAsc = (a, b) => {
    const result = nameCollator.compare((a.name || "").trim(), (b.name || "").trim());
    if (result !== 0) return result;
    return (a.id || "").localeCompare(b.id || "");
  };
  const sorted = [...state.listeners];

  // ステータスフィルタ適用
  const statusFilterSelect = document.getElementById("listener-status-filter");
  const statusFilterValue = statusFilterSelect ? statusFilterSelect.value : "";
  if (statusFilterValue) {
    const filtered = sorted.filter(listener => {
      const activeStatuses = getActiveStatusEntries(listener);
      return activeStatuses.some(statusEntry => statusEntry.assignment.statusId === statusFilterValue);
    });
    sorted.length = 0;
    sorted.push(...filtered);
  }

  // タグ検索適用
  const tagSearchInput = document.getElementById("listener-tag-search");
  const tagSearchValue = tagSearchInput ? tagSearchInput.value.trim() : "";
  if (tagSearchValue) {
    const filtered = sorted.filter(listener => {
      if (!Array.isArray(listener.tags)) return false;
      return listener.tags.some(tag => tag.toLowerCase().includes(tagSearchValue.toLowerCase()));
    });
    sorted.length = 0;
    sorted.push(...filtered);
  }

  sorted.sort((a, b) => {
    switch (state.listenerSortMode) {
      case "name-desc":
        return compareNameAsc(b, a);
      case "last-attended-asc": {
        const aTime = latestAttendanceMap.get(a.id);
        const bTime = latestAttendanceMap.get(b.id);
        const aValue = typeof aTime === "number" ? aTime : Number.POSITIVE_INFINITY;
        const bValue = typeof bTime === "number" ? bTime : Number.POSITIVE_INFINITY;
        if (aValue !== bValue) return aValue - bValue;
        return compareNameAsc(a, b);
      }
      case "last-attended-desc": {
        const aTime = latestAttendanceMap.get(a.id);
        const bTime = latestAttendanceMap.get(b.id);
        const aValue = typeof aTime === "number" ? aTime : Number.NEGATIVE_INFINITY;
        const bValue = typeof bTime === "number" ? bTime : Number.NEGATIVE_INFINITY;
        if (aValue !== bValue) return bValue - aValue;
        return compareNameAsc(a, b);
      }
      case "name-asc":
      default:
        return compareNameAsc(a, b);
    }
  });
  if (!sorted.length) {
    if (statusFilterValue && tagSearchValue) {
      const statusDef = getStatusDefinitionById(statusFilterValue);
      const statusName = statusDef ? statusDef.displayName : "該当ステータス";
      emptyMessage.textContent = `まだ「${statusName}」のステータスを持ち、「${tagSearchValue}」を含むタグのリスナーが登録されていません`;
    } else if (statusFilterValue) {
      const statusDef = getStatusDefinitionById(statusFilterValue);
      const statusName = statusDef ? statusDef.displayName : "該当ステータス";
      emptyMessage.textContent = `まだ「${statusName}」のステータスを持つリスナーが登録されていません`;
    } else if (tagSearchValue) {
      emptyMessage.textContent = `まだ「${tagSearchValue}」を含むタグのリスナーが登録されていません`;
    } else {
      emptyMessage.textContent = "まだリスナーが登録されていません";
    }
    emptyMessage.style.display = "block";
    return;
  }
  emptyMessage.style.display = "none";
  sorted.forEach(listener => {
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "list-item-header";
    const titleBlock = document.createElement("div");
    titleBlock.className = "list-title-block";

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = listener.name || "(名称未設定)";
    titleBlock.appendChild(title);

    const statusContainer = document.createElement("div");
    const hasStatusContent = populateStatusContainer(statusContainer, getActiveStatusEntries(listener), {
      showEmpty: true,
      size: "compact"
    });
    if (hasStatusContent) titleBlock.appendChild(statusContainer);

    header.appendChild(titleBlock);
    li.appendChild(header);

    const tagsLine = document.createElement("div");
    tagsLine.className = "list-sub";
    const tagsText = Array.isArray(listener.tags) && listener.tags.length ? listener.tags.join(", ") : "タグなし";
    tagsLine.textContent = tagsText;
    li.appendChild(tagsLine);

    const profilesLine = document.createElement("div");
    profilesLine.className = "list-sub";
    const profileLabels = Array.isArray(listener.profileIds)
      ? listener.profileIds
          .map(pid => state.profiles.find(p => p.id === pid))
          .filter(p => Boolean(p))
          .map(formatProfileLabel)
      : [];
    profilesLine.textContent = profileLabels.length ? `所属: ${profileLabels.join(" / ")}` : "所属プラットフォームなし";
    li.appendChild(profilesLine);

    const latestTimestamp = latestAttendanceMap.get(listener.id);
    const latestLine = document.createElement("div");
    latestLine.className = "list-sub";
    latestLine.textContent = latestTimestamp
      ? `最終参加: ${new Date(latestTimestamp).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
      : "最終参加記録なし";
    li.appendChild(latestLine);

    li.onclick = () => openListener(listener.id);
    list.appendChild(li);
  });
};

export const openListener = id => {
  state.currentListener = getListenerById(id);
  if (!state.currentListener) return;
  document.getElementById("listener-name").textContent = state.currentListener.name;
  const membershipLabels = Array.isArray(state.currentListener.profileIds)
    ? state.currentListener.profileIds
        .map(pid => state.profiles.find(p => p.id === pid))
        .filter(p => Boolean(p))
        .map(formatProfileLabel)
    : [];
  document.getElementById("listener-profile").textContent = membershipLabels.length ? membershipLabels.join(" / ") : "関連付けられたプラットフォームはありません";
  document.getElementById("listener-name-static").textContent = state.currentListener.name;
  document.getElementById("listener-memo").textContent = state.currentListener.memo ? state.currentListener.memo : "メモはまだ登録されていません";
  renderListenerUrls();
  renderListenerTags();
  renderListenerStatuses();
  renderListenerAttendances();
  renderListenerGifts();
  updateTabState('listener');
  showView("listener-detail-view");
};

const renderListenerTags = () => {
  const container = document.getElementById("listener-tags");
  container.innerHTML = "";
  if (!state.currentListener.tags || state.currentListener.tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "タグは未設定です";
    container.appendChild(empty);
    return;
  }
  state.currentListener.tags.forEach(tag => {
    if (!tag) return;
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    container.appendChild(chip);
  });
};

const renderListenerStatuses = () => {
  if (!state.currentListener) return;
  const activeEntries = getActiveStatusEntries(state.currentListener);
  const headerContainer = document.getElementById("listener-statuses");
  populateStatusContainer(headerContainer, activeEntries, { showEmpty: true, size: "compact" });
  const detailContainer = document.getElementById("listener-status-current");
  populateStatusContainer(detailContainer, activeEntries, { showEmpty: true });
  renderActiveStatusDetails(activeEntries);
};

const renderActiveStatusDetails = entries => {
  const container = document.getElementById("listener-status-detail");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "status-detail-empty";
    empty.textContent = "現在アクティブなステータスはありません";
    container.appendChild(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "status-detail-list";
  entries.forEach(entry => {
    const { assignment, definition } = entry;
    if (!assignment) return;
    const item = document.createElement("li");
    item.className = "status-detail-item";

    const labelText = definition
      ? definition.displayName || "(名称未設定)"
      : assignment.statusId || "未定義ステータス";
    const titleEl = document.createElement("div");
    titleEl.className = "status-detail-title";
    titleEl.textContent = labelText;
    item.appendChild(titleEl);

    if (definition && definition.description) {
      const description = document.createElement("div");
      description.className = "status-detail-description";
      description.textContent = definition.description;
      item.appendChild(description);
    }

    const stateEl = document.createElement("div");
    stateEl.className = "status-detail-meta";
    stateEl.textContent = "状態: 現在有効";
    item.appendChild(stateEl);

    if (assignment.activatedAt) {
      const activated = document.createElement("div");
      activated.className = "status-detail-meta";
      activated.textContent = `付与: ${formatDateTimeForDisplay(assignment.activatedAt)}`;
      item.appendChild(activated);
    }

    list.appendChild(item);
  });
  container.appendChild(list);
};

export const openListenerStatusManager = () => {
  if (!state.currentListener) {
    alert("リスナーを選択してから操作してください。");
    return;
  }
  if (!Array.isArray(state.currentListener.statusAssignments)) state.currentListener.statusAssignments = [];
  const activeIds = new Set();
  state.currentListener.statusAssignments.forEach(assignment => {
    if (!assignment || assignment.deactivatedAt) return;
    activeIds.add(assignment.statusId);
  });
  const statusItems = [];
  state.statusCatalog.forEach(status => {
    if (!status) return;
    const isActiveForListener = activeIds.has(status.id);
    if (status.isArchived && !isActiveForListener) return;
    const label = `${status.displayName || "(名称未設定)"}${status.isArchived ? "（アーカイブ）" : ""}`;
    const priority = Number.isFinite(status.displayPriority) ? status.displayPriority : 0;
    statusItems.push({ id: status.id, label, priority });
  });
  activeIds.forEach(statusId => {
    if (statusItems.some(item => item.id === statusId)) return;
    statusItems.push({ id: statusId, label: `${statusId}（未定義）`, priority: 0 });
  });
  if (statusItems.length === 0) {
    alert("付与可能なステータスがありません。先にステータス管理から定義を作成してください。");
    return;
  }
  statusItems.sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return nameCollator.compare(a.label, b.label);
  });
  const options = statusItems.map(item => ({ value: item.id, label: item.label }));
  const now = new Date();
  openModal("ステータス管理", [
    {
      name: "target",
      label: "対象リスナー",
      type: "static",
      value: state.currentListener.name || "(名称未設定)"
    },
    {
      name: "statusIds",
      label: "付与ステータス（複数選択可）",
      type: "checkboxes",
      options,
      value: Array.from(activeIds)
    },
    {
      name: "statusActivatedDate",
      label: "日付",
      type: "date",
      value: formatDateInputValue(now)
    },
    {
      name: "statusActivatedTime",
      label: "付与時刻",
      type: "time",
      value: formatTimeInputValue(now)
    }
  ], values => {
    const selectedSet = new Set(Array.isArray(values.statusIds) ? values.statusIds : []);
    const resolvedActivatedAt = buildIsoDateTime(values.statusActivatedDate, values.statusActivatedTime);
    let changed = false;

    const addAssignment = statusId => {
      state.currentListener.statusAssignments.push({
        statusId,
        source: "manual",
        activatedAt: resolvedActivatedAt,
        deactivatedAt: null,
        reason: "",
        note: ""
      });
      changed = true;
    };

    const deactivateAssignment = statusId => {
      const assignment = findActiveStatusAssignment(state.currentListener, statusId);
      if (!assignment) return;
      assignment.deactivatedAt = new Date().toISOString();
      changed = true;
    };

    statusItems.forEach(item => {
      const isActive = activeIds.has(item.id);
      const shouldBeActive = selectedSet.has(item.id);
      if (shouldBeActive && !isActive) addAssignment(item.id);
      if (!shouldBeActive && isActive) deactivateAssignment(item.id);
    });

    if (!changed) return;

    refreshCurrentView();
    refreshListenerDetail();
    renderAttendees();
  });
};

export const openListenerStatusHistory = () => {
  if (!state.currentListener) {
    alert("リスナーを選択してから操作してください。");
    return;
  }

  let showActiveOnly = false;
  const collectEntries = () => {
    const assignments = Array.isArray(state.currentListener.statusAssignments)
      ? state.currentListener.statusAssignments.filter(entry => entry && entry.statusId)
      : [];
    const decorated = assignments.map(assignment => ({
      assignment,
      definition: getStatusDefinitionById(assignment.statusId)
    }));
    decorated.sort((a, b) => {
      const aStart = parseIsoDateTime(a.assignment.activatedAt);
      const bStart = parseIsoDateTime(b.assignment.activatedAt);
      const aTime = aStart ? aStart.getTime() : 0;
      const bTime = bStart ? bStart.getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      const aLabel = a.definition ? (a.definition.displayName || a.definition.id || "") : (a.assignment.statusId || "");
      const bLabel = b.definition ? (b.definition.displayName || b.definition.id || "") : (b.assignment.statusId || "");
      return nameCollator.compare(aLabel, bLabel);
    });
    return decorated;
  };

  let editingAssignment = null;
  let filterButton = null;

  const resetEditingState = () => {
    editingAssignment = null;
  };

  const updateFilterButtonState = () => {
    if (!filterButton) return;
    filterButton.checked = showActiveOnly;
  };

  const handleFilterToggle = () => {
    if (editingAssignment) {
      const confirmed = confirm("編集中の履歴はキャンセルされます。フィルターを切り替えますか？");
      if (!confirmed) return;
      resetEditingState();
    }
    showActiveOnly = !showActiveOnly;
    updateFilterButtonState();
    renderHistoryContent();
  };

  const setupFilterUi = () => {
    if (!modalHeaderActions) return;
    modalHeaderActions.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "status-history-filter";
    const label = document.createElement("label");
    label.className = "status-history-filter-label";
    filterButton = document.createElement("input");
    filterButton.type = "checkbox";
    filterButton.className = "status-history-filter-checkbox";
    filterButton.checked = false;
    filterButton.onchange = handleFilterToggle;
    label.appendChild(filterButton);
    const labelText = document.createElement("span");
    labelText.className = "status-history-filter-text";
    labelText.textContent = "現在有効のみ表示";
    label.appendChild(labelText);
    wrapper.appendChild(label);
    modalHeaderActions.appendChild(wrapper);
    updateFilterButtonState();
  };

  const handleDelete = assignment => {
    if (!confirm("この履歴を削除しますか？")) return;
    state.currentListener.statusAssignments = state.currentListener.statusAssignments.filter(entry => entry !== assignment);
    saveAppData(markAutoBackupDirty);
    refreshCurrentView();
    refreshListenerDetail();
    renderAttendees();
    resetEditingState();
    renderHistoryContent();
  };

  const handleSave = (assignment, activatedInput, deactivatedInput) => {
    assignment.activatedAt = buildIsoFromDateTimeLocal(activatedInput.value);
    if (deactivatedInput) {
      assignment.deactivatedAt = buildIsoFromDateTimeLocal(deactivatedInput.value);
    }
    saveAppData(markAutoBackupDirty);
    refreshCurrentView();
    refreshListenerDetail();
    renderAttendees();
    resetEditingState();
    renderHistoryContent();
  };

  const createActions = assignment => {
    if (assignment.source === "system") return null;
    const actions = document.createElement("div");
    actions.className = "status-history-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "list-action-btn edit";
    editBtn.textContent = editingAssignment === assignment ? "編集中" : "編集";
    editBtn.disabled = Boolean(editingAssignment && editingAssignment !== assignment);
    editBtn.onclick = () => {
      if (editingAssignment === assignment) return;
      editingAssignment = assignment;
      renderHistoryContent();
    };
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "list-action-btn danger";
    deleteBtn.textContent = "削除";
    deleteBtn.disabled = Boolean(editingAssignment && editingAssignment !== assignment);
    deleteBtn.onclick = () => {
      if (editingAssignment && editingAssignment !== assignment) return;
      handleDelete(assignment);
    };
    actions.appendChild(deleteBtn);

    return actions;
  };

  const createEditor = assignment => {
    if (assignment.source === "system") return null;
    if (editingAssignment !== assignment) return null;
    const editor = document.createElement("div");
    editor.className = "status-history-edit";

    const activatedField = document.createElement("label");
    activatedField.className = "status-history-edit-field";
    activatedField.textContent = "付与日時";
    const activatedInput = document.createElement("input");
    activatedInput.type = "datetime-local";
    activatedInput.value = formatDateTimeLocalValue(assignment.activatedAt);
    activatedField.appendChild(activatedInput);
    editor.appendChild(activatedField);

    let deactivatedInput = null;
    if (assignment.deactivatedAt) {
      const deactivatedField = document.createElement("label");
      deactivatedField.className = "status-history-edit-field";
      deactivatedField.textContent = "解除日時";
      deactivatedInput = document.createElement("input");
      deactivatedInput.type = "datetime-local";
      deactivatedInput.value = formatDateTimeLocalValue(assignment.deactivatedAt);
      deactivatedField.appendChild(deactivatedInput);
      editor.appendChild(deactivatedField);
    }

    const buttonRow = document.createElement("div");
    buttonRow.className = "status-history-edit-buttons";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "status-history-edit-btn";
    saveBtn.textContent = "保存";
    saveBtn.onclick = () => handleSave(assignment, activatedInput, deactivatedInput);
    buttonRow.appendChild(saveBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "status-history-edit-btn status-history-edit-btn--secondary";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.onclick = () => {
      resetEditingState();
      renderHistoryContent();
    };
    buttonRow.appendChild(cancelBtn);

    editor.appendChild(buttonRow);
    return editor;
  };

  const renderHistoryContent = () => {
    modalBody.innerHTML = "";

    const target = document.createElement("p");
    target.className = "status-history-target";
    target.textContent = `対象リスナー: ${state.currentListener.name || "(名称未設定)"}`;
    modalBody.appendChild(target);

    const historyEntries = collectEntries();
    const filteredEntries = showActiveOnly
      ? historyEntries.filter(entry => !entry.assignment.deactivatedAt)
      : historyEntries;
    if (filteredEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "status-history-empty";
      empty.textContent = showActiveOnly
        ? "現在有効な履歴はありません"
        : "ステータス履歴はまだ記録されていません";
      modalBody.appendChild(empty);
      return;
    }

    const container = document.createElement("div");
    container.className = "status-history-container";
    const listEl = document.createElement("ul");
    listEl.className = "status-history-list";

    filteredEntries.forEach(entry => {
      const item = document.createElement("li");
      item.className = "status-history-item";
      if (editingAssignment && editingAssignment !== entry.assignment) {
        item.classList.add("status-history-item--disabled");
      }
      if (editingAssignment === entry.assignment) {
        item.classList.add("status-history-item--editing");
      }

      const { assignment, definition } = entry;
      const labelText = definition && (definition.displayName || definition.id)
        ? definition.displayName || definition.id
        : assignment.statusId || "未定義ステータス";
      const header = document.createElement("div");
      header.className = "status-history-header";

      const nameLabel = document.createElement("span");
      nameLabel.className = "status-history-name";
      nameLabel.textContent = labelText;
      header.appendChild(nameLabel);

      const stateEl = document.createElement("span");
      stateEl.className = "status-history-state";
      if (assignment.deactivatedAt) {
        stateEl.classList.add("status-history-state--inactive");
        stateEl.textContent = "解除済み";
      } else {
        stateEl.classList.add("status-history-state--active");
        stateEl.textContent = "現在有効";
      }
      header.appendChild(stateEl);
      item.appendChild(header);

      const source = document.createElement("div");
      source.className = "status-history-source";
      source.textContent = `付与経路: ${assignment.source === "system" ? "自動付与" : "手動操作"}`;
      item.appendChild(source);

      const meta = document.createElement("div");
      meta.className = "status-history-meta";
      meta.textContent = `付与: ${formatDateTimeForDisplay(assignment.activatedAt)}`;
      item.appendChild(meta);

      if (definition && definition.description) {
        const description = document.createElement("div");
        description.className = "status-history-description";
        description.textContent = `説明: ${definition.description}`;
        item.appendChild(description);
      }

      if (assignment.deactivatedAt) {
        const ended = document.createElement("div");
        ended.className = "status-history-meta";
        ended.textContent = `解除: ${formatDateTimeForDisplay(assignment.deactivatedAt)}`;
        item.appendChild(ended);
      }

      const actionsEl = createActions(assignment);
      if (actionsEl) item.appendChild(actionsEl);

      const editorEl = createEditor(assignment);
      if (editorEl) item.appendChild(editorEl);

      listEl.appendChild(item);
    });

    container.appendChild(listEl);
    modalBody.appendChild(container);
  };

  modalTitle.textContent = "ステータス履歴";
  setupFilterUi();
  renderHistoryContent();

  const okBtn = document.getElementById("modal-ok");
  if (okBtn) {
    okBtn.textContent = "閉じる";
    okBtn.onclick = () => closeModal();
  }
  modalBg.style.display = "flex";
};

const renderListenerUrls = () => {
  const container = document.getElementById("listener-urls");
  if (!container) return;
  container.innerHTML = "";
  const urls = Array.isArray(state.currentListener && state.currentListener.urls) ? state.currentListener.urls : [];
  if (!urls.length) {
    container.textContent = "URLは登録されていません";
    return;
  }
  const listEl = document.createElement("ul");
  listEl.className = "listener-url-list";
  urls.forEach(url => {
    if (!url) return;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.appendChild(link);
    listEl.appendChild(item);
  });
  container.appendChild(listEl);
};

const renderListenerAttendances = () => {
  const empty = document.getElementById("listener-attendance-empty");
  const list = document.getElementById("listener-attendance-list");
  list.innerHTML = "";
  const entries = [];
  state.profiles.forEach(profile => {
    const streams = Array.isArray(profile.streams) ? profile.streams : [];
    streams.forEach(stream => {
      if (!Array.isArray(stream.attendees)) return;
      if (!stream.attendees.includes(state.currentListener.id)) return;
      entries.push({ profile, stream });
    });
  });
  entries.sort((a, b) => {
    const aDate = parseStreamDate(a.stream.date, a.stream.startTime);
    const bDate = parseStreamDate(b.stream.date, b.stream.startTime);
    const aValue = aDate ? aDate.getTime() : 0;
    const bValue = bDate ? bDate.getTime() : 0;
    if (aValue !== bValue) return bValue - aValue;
    return (b.stream.title || "").localeCompare(a.stream.title || "");
  });
  if (entries.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  entries.forEach(({ profile, stream }) => {
    const li = document.createElement("li");
    li.textContent = `${formatStreamSchedule(stream)} / ${formatProfileLabel(profile)}`;
    li.onclick = () => {
      state.currentProfile = profile;
      document.getElementById("profile-title").textContent = formatProfileLabel(profile);
      openStream(stream.id);
    };
    list.appendChild(li);
  });
};

const renderListenerGifts = () => {
  const empty = document.getElementById("listener-gift-empty");
  const list = document.getElementById("listener-gift-list");
  const summary = document.getElementById("listener-gift-summary");
  list.innerHTML = "";
  summary.textContent = "";
  const records = [];
  state.profiles.forEach(profile => {
    const streams = Array.isArray(profile.streams) ? profile.streams : [];
    streams.forEach(stream => {
      if (!Array.isArray(stream.gifts)) return;
      stream.gifts.forEach(gift => {
        if (!gift || !gift.listenerId) return;
        if (gift.listenerId === state.currentListener.id) records.push({ profile, stream, gift });
      });
    });
  });
  records.sort((a, b) => {
    const aDate = parseStreamDate(a.stream.date, a.stream.startTime);
    const bDate = parseStreamDate(b.stream.date, b.stream.startTime);
    const aValue = aDate ? aDate.getTime() : 0;
    const bValue = bDate ? bDate.getTime() : 0;
    if (aValue !== bValue) return bValue - aValue;
    return (b.stream.title || "").localeCompare(a.stream.title || "");
  });
  if (records.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  let total = 0, total30 = 0, hasAmount = false;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  records.forEach(({ profile, stream, gift }) => {
    const li = document.createElement("li");
    li.textContent = `${formatStreamSchedule(stream)} / ${formatProfileLabel(profile)} - ${gift.item || "ギフト"} (${gift.amount || "金額未入力"})`;
    li.onclick = () => {
      state.currentProfile = profile;
      document.getElementById("profile-title").textContent = formatProfileLabel(profile);
      openStream(stream.id);
    };
    list.appendChild(li);
    const parsed = parseGiftAmount(gift.amount);
    if (parsed !== null) {
      hasAmount = true;
      total += parsed;
      const streamDate = parseStreamDate(stream.date, stream.startTime);
      if (streamDate && streamDate >= thirtyDaysAgo) total30 += parsed;
    }
  });
  summary.textContent = hasAmount ? `直近30日合計: ${total30} / 全期間合計: ${total}` : "金額合計は未集計です";
};

const isListenerDetailActive = () => {
  const view = document.getElementById("listener-detail-view");
  return view ? view.classList.contains("active") : false;
};

export const refreshListenerDetail = () => {
  if (!state.currentListener || !isListenerDetailActive()) return;
  document.getElementById("listener-name").textContent = state.currentListener.name;
  const membershipLabels = Array.isArray(state.currentListener.profileIds)
    ? state.currentListener.profileIds
        .map(pid => state.profiles.find(p => p.id === pid))
        .filter(p => Boolean(p))
        .map(formatProfileLabel)
    : [];
  document.getElementById("listener-profile").textContent = membershipLabels.length
    ? membershipLabels.join(" / ")
    : "関連付けられたプラットフォームはありません";
  document.getElementById("listener-name-static").textContent = state.currentListener.name;
  document.getElementById("listener-memo").textContent = state.currentListener.memo
    ? state.currentListener.memo
    : "メモはまだ登録されていません";
  renderListenerUrls();
  renderListenerTags();
  renderListenerStatuses();
  renderListenerAttendances();
  renderListenerGifts();
};

export const initializeListenerStatusFilter = () => {
  const filterSelect = document.getElementById('listener-status-filter');
  if (!filterSelect) return;

  // 現在の選択値を保存
  const currentValue = filterSelect.value;

  // 既存のオプションをクリア（「すべて」は残す）
  filterSelect.innerHTML = '<option value="">すべて</option>';

  // アクティブなステータスを取得
  const activeStatuses = state.statusCatalog.filter(status => !status.isArchived);

  // 表示優先度でソート
  activeStatuses.sort((a, b) => (b.displayPriority || 0) - (a.displayPriority || 0));

  // オプションを追加
  activeStatuses.forEach(status => {
    const option = document.createElement('option');
    option.value = status.id;
    option.textContent = status.displayName;
    filterSelect.appendChild(option);
  });

  // 選択値を復元（有効なオプションが存在する場合のみ）
  if (currentValue && filterSelect.querySelector(`option[value="${currentValue}"]`)) {
    filterSelect.value = currentValue;
  }

  // イベントリスナーを設定（既に設定されている場合は追加しない）
  if (!filterSelect.hasAttribute('data-listener-attached')) {
    filterSelect.addEventListener('change', () => {
      renderListenerList();
    });
    filterSelect.setAttribute('data-listener-attached', 'true');
  }

  // タグ検索フィールドのイベントリスナーを設定
  const tagSearchInput = document.getElementById('listener-tag-search');
  if (tagSearchInput && !tagSearchInput.hasAttribute('data-listener-attached')) {
    tagSearchInput.addEventListener('input', () => {
      renderListenerList();
    });
    tagSearchInput.setAttribute('data-listener-attached', 'true');
  }
};
