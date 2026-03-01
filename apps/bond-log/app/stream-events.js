// BondLog 配信詳細モジュール
// 配信の参加者一覧・ギフト一覧の描画・操作を管理する

import {
  generateId, formatStreamSchedule, nameCollator, parseGiftAmount
} from "./utils.js";
import { state, getListenerById, getProfileListeners, linkListenerToProfile } from "./state.js";
import { saveAppData } from "./storage.js";
import { markAutoBackupDirty } from "./auto-backup.js";
import { openModal, modalBody } from "./modal.js";
import {
  getActiveStatusEntries, populateStatusContainer
} from "./status-badge.js";
import {
  showView, refreshCurrentView, updateTabState, createActionButton
} from "./navigation.js";
import { updateStreamUrlLink } from "./platform.js";
// 循環依存あり: listener.js（ランタイム参照のみ、モジュール評価時には使用しない）
import { openListener, refreshListenerDetail } from "./listener.js";

export const openStream = id => {
  state.currentStream = state.currentProfile.streams.find(s => s.id === id);
  const titleElem = document.getElementById("stream-title");
  const scheduleElem = document.getElementById("stream-schedule");
  if (!state.currentStream) {
    titleElem.textContent = "";
    if (scheduleElem) scheduleElem.textContent = "";
    updateStreamUrlLink(null);
    return;
  }
  titleElem.textContent = state.currentStream.title || "無題の配信";
  if (scheduleElem) scheduleElem.textContent = formatStreamSchedule(state.currentStream);
  updateStreamUrlLink(state.currentStream);
  renderAttendees(); renderGifts();
  updateTabState('platform');
  showView("stream-detail-view");
};

export const renderAttendees = () => {
  const list = document.getElementById("attendee-list");
  list.innerHTML = "";
  if (!state.currentStream) return;
  const attendees = Array.isArray(state.currentStream.attendees) ? state.currentStream.attendees : [];
  attendees.forEach((listenerId, index) => {
    const listener = getListenerById(listenerId);
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "list-item-header";

    const titleBlock = document.createElement("div");
    titleBlock.className = "list-title-block";

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = listener ? listener.name : "不明なリスナー";
    titleBlock.appendChild(title);

    if (listener) {
      const statusContainer = document.createElement("div");
      const hasStatus = populateStatusContainer(statusContainer, getActiveStatusEntries(listener), {
        showEmpty: true,
        size: "compact"
      });
      if (hasStatus) titleBlock.appendChild(statusContainer);
    }

    header.appendChild(titleBlock);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    actions.appendChild(createActionButton("編集", "edit", () => openAttendeeEditModal(index)));
    actions.appendChild(createActionButton("削除", "danger", () => {
      const targetName = listener ? listener.name : "この参加者";
      if (!confirm(`${targetName} を参加者一覧から削除しますか？`)) return;
      state.currentStream.attendees.splice(index, 1);
      saveAppData(markAutoBackupDirty);
      renderAttendees();
      refreshCurrentView();
      refreshListenerDetail();
    }));
    header.appendChild(actions);

    li.appendChild(header);
    if (listener) {
      li.classList.add("list-link");
      li.onclick = () => openListener(listener.id);
    }
    list.appendChild(li);
  });
};

export const openAttendeeEditModal = attendeeIndex => {
  if (!state.currentStream || attendeeIndex < 0) return;
  const currentListenerId = state.currentStream.attendees[attendeeIndex] || "";
  const currentListenerObj = currentListenerId ? getListenerById(currentListenerId) : null;
  const NEW_OPTION_VALUE = "__new_listener__";
  const baseListeners = getProfileListeners(state.currentProfile.id);
  if (currentListenerObj && !baseListeners.some(l => l.id === currentListenerObj.id)) {
    baseListeners.push(currentListenerObj);
  }
  const selectOptions = baseListeners.map(listener => ({
    value: listener.id,
    label: listener.name || "(名称未設定)"
  }));
  selectOptions.push({ value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを登録" });
  openModal("参加者を編集", [
    {
      name: "listenerSelect",
      label: "リスナーを選択",
      type: "select",
      options: selectOptions,
      value: currentListenerObj ? currentListenerObj.id : NEW_OPTION_VALUE,
      onCreate: (element, wrapper) => {
        wrapper.dataset.field = "listenerSelect";
        const toggleInput = () => {
          const inputWrap = modalBody.querySelector('[data-field="listenerNew"]');
          if (!inputWrap) return;
          inputWrap.style.display = element.value === NEW_OPTION_VALUE ? "" : "none";
        };
        element.addEventListener("change", toggleInput);
        toggleInput();
      }
    },
    {
      name: "listenerNew",
      label: "新規リスナー名",
      type: "text",
      placeholder: "新しいリスナー名を入力",
      hidden: true,
      onCreate: (_element, wrapper) => {
        wrapper.dataset.field = "listenerNew";
      }
    }
  ], values => {
    const mode = values.listenerSelect;
    if (mode === NEW_OPTION_VALUE) {
      const newName = (values.listenerNew || "").trim();
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
      state.currentStream.attendees[attendeeIndex] = newListener.id;
      refreshCurrentView();
      renderAttendees();
      refreshListenerDetail();
      return;
    }
    const listener = getListenerById(mode);
    if (!listener) {
      alert("リスナーを選択してください");
      return;
    }
    linkListenerToProfile(listener, state.currentProfile.id);
    state.currentStream.attendees[attendeeIndex] = listener.id;
    renderAttendees();
    refreshCurrentView();
    refreshListenerDetail();
  });
};

export const renderGifts = () => {
  const list = document.getElementById("gift-list");
  list.innerHTML = "";
  if (!state.currentStream) return;
  const gifts = Array.isArray(state.currentStream.gifts) ? state.currentStream.gifts : [];
  gifts.forEach((gift, index) => {
    const listener = getListenerById(gift.listenerId);
    const listenerName = listener ? listener.name : "不明なリスナー";
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "list-item-header";

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = `${listenerName} - ${gift.item || "ギフト"} (${gift.amount || "金額未入力"})`;
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    actions.appendChild(createActionButton("編集", "edit", () => openGiftEditModal(index)));
    actions.appendChild(createActionButton("削除", "danger", () => {
      const targetLabel = listener ? `${listenerName} のギフト` : "このギフト";
      if (!confirm(`${targetLabel} を削除しますか？`)) return;
      state.currentStream.gifts.splice(index, 1);
      saveAppData(markAutoBackupDirty);
      renderGifts();
      refreshCurrentView();
      refreshListenerDetail();
    }));
    header.appendChild(actions);

    li.appendChild(header);
    if (listener) {
      li.classList.add("list-link");
      li.onclick = () => openListener(listener.id);
    }
    list.appendChild(li);
  });
};

export const openGiftEditModal = giftIndex => {
  if (!state.currentStream || giftIndex < 0) return;
  const gift = state.currentStream.gifts[giftIndex];
  if (!gift) return;
  const NEW_OPTION_VALUE = "__new_listener__";
  const baseListeners = getProfileListeners(state.currentProfile.id);
  const giftListener = gift.listenerId ? getListenerById(gift.listenerId) : null;
  if (giftListener && !baseListeners.some(l => l.id === giftListener.id)) {
    baseListeners.push(giftListener);
  }
  const selectOptions = baseListeners.map(listener => ({
    value: listener.id,
    label: listener.name || "(名称未設定)"
  }));
  selectOptions.push({ value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを登録" });
  openModal("ギフトを編集", [
    {
      name: "listener",
      label: "リスナー",
      type: "select",
      options: selectOptions,
      value: giftListener ? giftListener.id : NEW_OPTION_VALUE,
      onCreate: (element, wrapper) => {
        wrapper.dataset.field = "giftListener";
        const toggleInput = () => {
          const inputWrap = modalBody.querySelector('[data-field="giftListenerNew"]');
          if (!inputWrap) return;
          inputWrap.style.display = element.value === NEW_OPTION_VALUE ? "" : "none";
        };
        element.addEventListener("change", toggleInput);
        toggleInput();
      }
    },
    {
      name: "listenerNew",
      label: "新規リスナー名",
      type: "text",
      placeholder: "新しいリスナー名を入力",
      hidden: true,
      onCreate: (_element, wrapper) => {
        wrapper.dataset.field = "giftListenerNew";
      }
    },
    { name: "item", label: "ギフト内容", value: gift.item || "" },
    { name: "amount", label: "金額やポイント", value: gift.amount || "" }
  ], values => {
    let targetListenerId = values.listener;
    if (targetListenerId === NEW_OPTION_VALUE) {
      const newName = (values.listenerNew || "").trim();
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
      targetListenerId = newListener.id;
    }
    const listener = getListenerById(targetListenerId);
    if (!listener) {
      alert("リスナーを選択してください");
      return;
    }
    linkListenerToProfile(listener, state.currentProfile.id);
    gift.listenerId = listener.id;
    gift.item = (values.item || "").trim();
    gift.amount = (values.amount || "").trim();
    renderGifts();
    refreshCurrentView();
    refreshListenerDetail();
  });
};
