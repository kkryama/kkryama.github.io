// BondLog モーダルダイアログモジュール
// 汎用モーダルの表示・操作

import { saveAppData } from "./storage.js";
import { markAutoBackupDirty } from "./auto-backup.js";

// --- DOM キャッシュ ---
export const modalBg = document.getElementById("modal-bg");
export const modalBody = document.getElementById("modal-body");
export const modalTitle = document.getElementById("modal-title");
export const modalHeaderActions = document.getElementById("modal-header-actions");

// --- モーダル操作 ---

export const closeModal = () => {
  modalBg.style.display = "none";
  if (modalHeaderActions) modalHeaderActions.innerHTML = "";
  const okBtn = document.getElementById("modal-ok");
  if (okBtn) {
    okBtn.textContent = "OK";
    okBtn.onclick = null;
  }
  // Escape ハンドラを解除
  if (modalBg && modalBg._escHandler) {
    document.removeEventListener('keydown', modalBg._escHandler);
    modalBg._escHandler = null;
  }
};

export function openModal(title, fields, onSubmit) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  if (modalHeaderActions) modalHeaderActions.innerHTML = "";
  fields.forEach(f => {
    const wrapper = document.createElement("div");
    wrapper.className = "modal-field";
    if (f.hidden) wrapper.style.display = "none";
    const labelText = f.label || "";
    const isSingleCheckbox = f.type === "checkbox";
    let checkboxLabelWrapper = null;
    if (isSingleCheckbox) {
      wrapper.classList.add("modal-field--checkbox");
      checkboxLabelWrapper = document.createElement("label");
      checkboxLabelWrapper.className = "modal-checkbox-inline";
      wrapper.appendChild(checkboxLabelWrapper);
    } else if (labelText) {
      const label = document.createElement("div");
      label.className = "modal-label";
      label.textContent = labelText;
      wrapper.appendChild(label);
    }
    let element;
    if (f.type === "select") {
      element = document.createElement("select");
      f.options.forEach(opt => {
        const optionValue = typeof opt === "string" ? opt : opt.value;
        const optionLabel = typeof opt === "string" ? opt : (opt.label || opt.value);
        const o = document.createElement("option");
        o.value = optionValue;
        o.textContent = optionLabel;
        element.appendChild(o);
      });
    } else if (f.type === "datalist") {
      element = document.createElement("input");
      element.type = "text";
      element.placeholder = f.placeholder || labelText;
      if (Array.isArray(f.options)) {
        const listId = `${f.name}-datalist`;
        element.setAttribute("list", listId);
        const dataList = document.createElement("datalist");
        dataList.id = listId;
        f.options.forEach(opt => {
          const optionElem = document.createElement("option");
          optionElem.value = opt;
          dataList.appendChild(optionElem);
        });
        wrapper.appendChild(dataList);
      }
    } else if (f.type === "checkboxes") {
      element = document.createElement("div");
      element.className = "modal-checkbox-group";
      element.dataset.checkboxGroup = "true";
      const optionList = Array.isArray(f.options) ? f.options : [];
      const defaultValues = Array.isArray(f.value) ? f.value : [];
      if (optionList.length === 0) {
        const note = document.createElement("div");
        note.className = "modal-static";
        note.textContent = "選択できる項目がありません";
        element.appendChild(note);
      } else {
        optionList.forEach(opt => {
          const optionValue = typeof opt === "string" ? opt : opt.value;
          const optionLabel = typeof opt === "string" ? opt : (opt.label || opt.value);
          const checkboxId = `${f.name}-${optionValue}`;
          const optionWrapper = document.createElement("label");
          optionWrapper.className = "modal-checkbox-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = optionValue;
          checkbox.id = checkboxId;
          if (defaultValues.includes(optionValue)) checkbox.checked = true;
          const text = document.createElement("span");
          text.textContent = optionLabel;
          optionWrapper.appendChild(checkbox);
          optionWrapper.appendChild(text);
          element.appendChild(optionWrapper);
        });
      }
    } else if (f.type === "checkbox") {
      element = document.createElement("input");
      element.type = "checkbox";
      element.checked = Boolean(f.value);
    } else if (f.type === "static") {
      element = document.createElement("div");
      element.className = "modal-static";
      element.textContent = f.value || "";
      element.setAttribute("data-static", "true");
    } else if (f.type === "textarea") {
      element = document.createElement("textarea");
      element.placeholder = f.placeholder || labelText;
    } else {
      element = document.createElement("input");
      element.type = f.type || "text";
      element.placeholder = f.placeholder || labelText;
      if (f.inputmode) element.setAttribute('inputmode', f.inputmode);
      if (f.step !== undefined) element.setAttribute('step', String(f.step));
      if (f.min !== undefined) element.setAttribute('min', String(f.min));
      if (f.max !== undefined) element.setAttribute('max', String(f.max));
    }
    element.id = f.name;
    if (f.value !== undefined && !["static", "checkboxes", "checkbox"].includes(f.type || "")) {
      element.value = f.value;
    }
    if (isSingleCheckbox && checkboxLabelWrapper) {
      checkboxLabelWrapper.appendChild(element);
      if (labelText) {
        const checkboxText = document.createElement("span");
        checkboxText.textContent = labelText;
        checkboxLabelWrapper.appendChild(checkboxText);
      }
    } else {
      wrapper.appendChild(element);
    }
    if (typeof f.onCreate === "function") f.onCreate(element, wrapper);
    modalBody.appendChild(wrapper);
    if (f.type === "select" && f.value !== undefined) element.value = f.value;
  });
  // アクセシビリティ属性とフォーカス処理
  const modalEl = document.getElementById('modal');
  if (modalEl) {
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'modal-title');
  }
  modalBg.style.display = "flex";
  // フォーカスを最初の入力要素へ
  setTimeout(() => {
    const firstInput = modalBody.querySelector('input:not([type=hidden]):not([data-static]), textarea, select');
    if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
  }, 0);
  // Escape キーで閉じるハンドラ（modalBg プロパティに保持して close 時に解除できるようにする）
  modalBg._escHandler = e => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', modalBg._escHandler);
  const okBtn = document.getElementById("modal-ok");
  // ボタンラベル: タイトルに「追加」が含まれる場合は「追加」、それ以外は「保存」を採用
  if (okBtn) {
    okBtn.textContent = /追加|作成/.test(title) ? '追加' : '保存';
  }
  document.getElementById("modal-ok").onclick = () => {
    const values = {};
    fields.forEach(f => {
      const el = document.getElementById(f.name);
      if (!el) {
        values[f.name] = "";
        return;
      }
      if (f.type === "checkbox") {
        values[f.name] = Boolean(el.checked);
        return;
      }
      if (el.dataset && el.dataset.checkboxGroup === "true") {
        values[f.name] = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
        return;
      }
      if (el.getAttribute && el.getAttribute("data-static") === "true") {
        values[f.name] = el.textContent || "";
        return;
      }
      values[f.name] = el.value;
    });
    onSubmit(values);
    saveAppData(markAutoBackupDirty);
    closeModal();
    // Escape ハンドラを解除
    if (modalBg && modalBg._escHandler) {
      document.removeEventListener('keydown', modalBg._escHandler);
      modalBg._escHandler = null;
    }
  };
}

// --- 初期化時のイベントバインド ---
document.getElementById("modal-cancel").onclick = closeModal;
modalBg.onclick = e => { if (e.target === modalBg) closeModal(); };
