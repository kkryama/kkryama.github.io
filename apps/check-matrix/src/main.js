import {
  DEFAULT_DATA,
  buildMatrix,
  normalizeData,
  loadFromStorage,
  saveToStorage,
  toJsonBlob,
  clearStorage,
  getDefaultData,
  addColumn,
  renameColumn,
  removeColumn,
  addItem,
  updateItem,
  removeItem,
  addTag,
  updateTag,
  deleteTag,
  reorderTags,
  addValueSetEntry,
  updateValueSetEntry,
  removeValueSetEntry,
  reorderValueSet
} from "./dataUtils.js";
import { createCsvStringFromTableData } from "./csvUtils.js";
import { loadReadOnlyPreference, saveReadOnlyPreference, createReadOnlyGuard } from "./readOnlyState.js";

const UNTAGGED_TAG_VALUE = "__untagged__";
const DEFAULT_VALUE_COLOR = "#E5E7EB";

const VALUE_SET_COLOR_PRESETS = [
  { value: "#E5E7EB", name: "ライトグレー" },
  { value: "#FDE68A", name: "ライトイエロー" },
  { value: "#BBF7D0", name: "ライトグリーン" },
  { value: "#BFDBFE", name: "ライトブルー" },
  { value: "#FBCFE8", name: "ライトピンク" },
  { value: "#FECACA", name: "サーモン" },
  { value: "#DDD6FE", name: "ラベンダー" },
  { value: "#F5D0C5", name: "アプリコット" }
].map((preset) => ({
  value: normalizeHexColor(preset.value) ?? DEFAULT_VALUE_COLOR,
  name: preset.name
}));

const DEFAULT_VALUE_SET_COLOR = VALUE_SET_COLOR_PRESETS[0]?.value ?? DEFAULT_VALUE_COLOR;
const DEFAULT_TEXT_COLOR = "var(--text-color)";
const CONTRAST_TEXT_COLOR = "#FFFFFF";
const READONLY_ALERT_MESSAGE = "読み取り専用モードになっています [OK]";

const state = {
  data: DEFAULT_DATA,
  selectedColumnIds: null,
  selectedTags: null,
  selectedItemIds: null,
  pendingFocus: null,
  tagEditingId: null,
  valueSetEditingIndex: null,
  valueSetPendingFocusIndex: null,
  valueSetFormColor: DEFAULT_VALUE_SET_COLOR,
  isReadOnly: false
};

function hexToRgbChannels(value) {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return null;
  }
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b };
}

function srgbChannelToLinear(channel) {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(hexColor) {
  const channels = hexToRgbChannels(hexColor);
  if (!channels) {
    return null;
  }
  const r = srgbChannelToLinear(channels.r);
  const g = srgbChannelToLinear(channels.g);
  const b = srgbChannelToLinear(channels.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getReadableTextColor(backgroundColor) {
  const luminance = getRelativeLuminance(backgroundColor);
  if (luminance == null) {
    return DEFAULT_TEXT_COLOR;
  }
  return luminance < 0.55 ? CONTRAST_TEXT_COLOR : DEFAULT_TEXT_COLOR;
}

function getNormalizedColor(value) {
  return normalizeHexColor(value) ?? DEFAULT_VALUE_COLOR;
}

function createCellColorStyle(entry) {
  if (!entry) {
    return null;
  }
  const backgroundColor = getNormalizedColor(entry.color);
  return {
    backgroundColor,
    textColor: getReadableTextColor(backgroundColor)
  };
}

function findColorPreset(color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return null;
  }
  return VALUE_SET_COLOR_PRESETS.find((preset) => preset.value === normalized) ?? null;
}

function getEffectiveValueSetColor(color) {
  const normalized = normalizeHexColor(color);
  if (normalized) {
    return normalized;
  }
  return DEFAULT_VALUE_SET_COLOR;
}

function createColorOptionElement(name, preset, checked) {
  const label = document.createElement("label");
  label.classList.add("value-set-color-option");
  label.title = `${preset.name} (${preset.value})`;

  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = preset.value;
  input.classList.add("value-set-color-option__radio");
  if (checked) {
    input.checked = true;
  }
  input.setAttribute("aria-label", `${preset.name} (${preset.value})`);

  const swatch = document.createElement("span");
  swatch.classList.add("value-set-color-option__swatch");
  swatch.style.backgroundColor = preset.value;
  swatch.setAttribute("aria-hidden", "true");

  const nameElement = document.createElement("span");
  nameElement.classList.add("value-set-color-option__name");
  nameElement.textContent = preset.name;

  const code = document.createElement("span");
  code.classList.add("value-set-color-option__code");
  code.textContent = preset.value;

  label.appendChild(input);
  label.appendChild(swatch);
  label.appendChild(nameElement);
  label.appendChild(code);
  return label;
}

function normalizeHexColor(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

function toValueSetEntry(entry, index) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `value-${index + 1}`;
    const label = typeof entry.label === "string" ? entry.label : "";
    const color = normalizeHexColor(entry.color) ?? DEFAULT_VALUE_COLOR;
    return { id, label, color };
  }
  const label = typeof entry === "string" ? entry : String(entry ?? "");
  return {
    id: `value-${index + 1}`,
    label,
    color: DEFAULT_VALUE_COLOR
  };
}

function getValueSetEntries() {
  const raw = Array.isArray(state.data?.valueSet) ? state.data.valueSet : [];
  if (raw.length === 0) {
    return Array.isArray(DEFAULT_DATA?.valueSet) ? DEFAULT_DATA.valueSet : [];
  }
  if (raw.every((entry) => entry && typeof entry.id === "string" && entry.id.trim())) {
    return raw;
  }
  return raw.map((entry, index) => toValueSetEntry(entry, index));
}

function getValueSetIds() {
  return getValueSetEntries().map((entry, index) => {
    if (entry && typeof entry.id === "string" && entry.id.trim()) {
      return entry.id;
    }
    return `value-${index + 1}`;
  });
}

function getValueSetEntryById(id) {
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }
  return getValueSetEntries().find((entry) => entry.id === trimmed) ?? null;
}

function getValueSetEntryByLabel(label) {
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  const entries = getValueSetEntries();
  if (!trimmed) {
    return entries.find((entry) => entry.label === "") ?? null;
  }
  return (
    entries.find((entry) => entry.label === trimmed) ??
    entries.find((entry) => entry.label?.toLowerCase() === trimmed.toLowerCase()) ??
    null
  );
}

function resolveValueSetEntry(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value) && typeof value.id === "string") {
    return getValueSetEntryById(value.id) ?? null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return getValueSetEntryById(trimmed) ?? getValueSetEntryByLabel(trimmed);
  }
  if (typeof value === "number") {
    return resolveValueSetEntry(String(value));
  }
  if (typeof value === "boolean") {
    return resolveValueSetEntry(value ? "true" : "false");
  }
  return null;
}

function getValueSetBooleanPairFromState() {
  const entries = getValueSetEntries();
  const falseEntry = getValueSetEntryByLabel("false") ?? entries[0] ?? null;
  let trueEntry = getValueSetEntryByLabel("true") ?? null;
  if (!trueEntry) {
    if (entries.length > 1) {
      trueEntry = entries[1];
    } else {
      trueEntry = entries[0] ?? null;
    }
  }
  return {
    trueEntry,
    falseEntry,
    trueId: trueEntry?.id ?? null,
    falseId: falseEntry?.id ?? null
  };
}

function isCellActive(value) {
  if (value == null) {
    return false;
  }
  const { trueId, falseId } = getValueSetBooleanPairFromState();
  const entry = resolveValueSetEntry(value);
  if (entry) {
    if (trueId && entry.id === trueId) {
      return true;
    }
    if (falseId && entry.id === falseId) {
      return false;
    }
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return true;
}

function getNextValue(currentValue) {
  const ids = getValueSetIds();
  if (ids.length === 0) {
    return null;
  }
  if (currentValue == null) {
    return ids[0] ?? null;
  }
  const resolved = resolveValueSetEntry(currentValue);
  const currentId =
    resolved?.id ??
    (typeof currentValue === "string" ? currentValue.trim() : String(currentValue));
  const currentIndex = ids.indexOf(currentId);
  if (currentIndex === -1) {
    return ids[0] ?? null;
  }
  if (currentIndex === ids.length - 1) {
    return null;
  }
  return ids[currentIndex + 1];
}

function getCellAriaLabel(columnName, value) {
  if (value == null) {
    return `${columnName}: 未設定`;
  }
  const entry = resolveValueSetEntry(value);
  if (!entry) {
    if (value === "") {
      return `${columnName}: 空文字`;
    }
    return `${columnName}: ${value}`;
  }
  const label = entry.label === "" ? "空文字" : entry.label;
  return `${columnName}: ${label}`;
}

function getValueSetDisplayLabel(value) {
  const entry = resolveValueSetEntry(value);
  if (!entry) {
    if (value === "") {
      return "空文字";
    }
    if (value == null) {
      return "";
    }
    return typeof value === "string" ? value : String(value);
  }
  return entry.label === "" ? "空文字" : entry.label;
}

function getValueSetAriaDescription(value) {
  const entry = resolveValueSetEntry(value);
  if (!entry) {
    if (value === "") {
      return "空文字 (空文字列)";
    }
    return value == null ? "未設定" : String(value);
  }
  return entry.label === "" ? "空文字 (空文字列)" : entry.label;
}

const tagDragState = {
  sourceIndex: -1
};

const valueSetDragState = {
  sourceIndex: -1
};

const elements = {
  appRoot: document.querySelector(".app"),
  fileInput: document.querySelector("#json-file"),
  loadButton: document.querySelector("#load-json"),
  saveButton: document.querySelector("#save-json"),
  exportCsvButton: document.querySelector("#export-csv"),
  filterToggle: document.querySelector("#toggle-filter"),
  filterPanel: document.querySelector("#column-filter"),
  columnCheckboxes: document.querySelector("#column-checkboxes"),
  selectAllColumns: document.querySelector("#select-all-columns"),
  clearAllColumns: document.querySelector("#clear-all-columns"),
  readOnlyToggle: document.querySelector("#readonly-mode"),
  resetButton: document.querySelector("#reset-data"),
  addItemButton: document.querySelector("#add-item"),
  addColumnButton: document.querySelector("#add-column"),
  manageValueSetButton: document.querySelector("#manage-value-set"),
  manageTagsButton: document.querySelector("#manage-tags"),
  tagFilterToggle: document.querySelector("#toggle-tag-filter"),
  tagFilterPanel: document.querySelector("#tag-filter"),
  tagCheckboxes: document.querySelector("#tag-checkboxes"),
  selectAllTags: document.querySelector("#select-all-tags"),
  clearAllTags: document.querySelector("#clear-all-tags"),
  itemFilterToggle: document.querySelector("#toggle-item-filter"),
  itemFilterPanel: document.querySelector("#item-filter"),
  itemCheckboxes: document.querySelector("#item-checkboxes"),
  selectAllItems: document.querySelector("#select-all-items"),
  clearAllItems: document.querySelector("#clear-all-items"),
  matrixTable: document.querySelector("#matrix-table"),
  tableHead: document.querySelector("#matrix-table thead"),
  tableBody: document.querySelector("#matrix-table tbody"),
  emptyState: document.querySelector("#empty-state"),
  checkboxTemplate: document.querySelector("#column-checkbox-template"),
  columnDialog: document.querySelector("#column-dialog"),
  columnForm: document.querySelector("#column-form"),
  columnNameInput: document.querySelector("#column-name"),
  columnSubmitButton: document.querySelector("#column-submit"),
  columnDialogTitle: document.querySelector("#column-dialog-title"),
  columnError: document.querySelector("#column-error"),
  itemDialog: document.querySelector("#item-dialog"),
  itemForm: document.querySelector("#item-form"),
  itemNameInput: document.querySelector("#item-name"),
  itemTagInput: document.querySelector("#item-tag"),
  itemColumnOptions: document.querySelector("#item-column-options"),
  itemDialogTitle: document.querySelector("#item-dialog-title"),
  itemSubmitButton: document.querySelector("#item-submit"),
  itemError: document.querySelector("#item-error"),
  tagDialog: document.querySelector("#tag-dialog"),
  tagDialogTitle: document.querySelector("#tag-dialog-title"),
  tagList: document.querySelector("#tag-list"),
  tagForm: document.querySelector("#tag-form"),
  tagNameInput: document.querySelector("#tag-name"),
  tagSubmitButton: document.querySelector("#tag-submit"),
  tagDialogError: document.querySelector("#tag-error"),
  tagDialogCloseButtons: document.querySelectorAll("[data-action='close-tag-dialog']"),
  valueSetDialog: document.querySelector("#value-set-dialog"),
  valueSetList: document.querySelector("#value-set-list"),
  valueSetForm: document.querySelector("#value-set-form"),
  valueSetInput: document.querySelector("#value-set-input"),
  valueSetColorOptions: document.querySelector("#value-set-color-options"),
  valueSetSubmitButton: document.querySelector("#value-set-submit"),
  valueSetError: document.querySelector("#value-set-error"),
  valueSetDialogCloseButtons: document.querySelectorAll("[data-action='close-value-set-dialog']")
};

function ensureValueSetElements() {
  if (!elements.manageValueSetButton) {
    elements.manageValueSetButton = document.querySelector("#manage-value-set");
  }
  if (!elements.valueSetDialog) {
    elements.valueSetDialog = document.querySelector("#value-set-dialog");
  }
  if (!elements.valueSetList) {
    elements.valueSetList = document.querySelector("#value-set-list");
  }
  if (!elements.valueSetForm) {
    elements.valueSetForm = document.querySelector("#value-set-form");
  }
  if (!elements.valueSetInput) {
    elements.valueSetInput = document.querySelector("#value-set-input");
  }
  if (!elements.valueSetColorOptions) {
    elements.valueSetColorOptions = document.querySelector("#value-set-color-options");
  }
  if (!elements.valueSetError) {
    elements.valueSetError = document.querySelector("#value-set-error");
  }
  if (!elements.valueSetDialogCloseButtons || elements.valueSetDialogCloseButtons.length === 0) {
    elements.valueSetDialogCloseButtons = document.querySelectorAll("[data-action='close-value-set-dialog']");
  }
}

function renderValueSetFormColorOptions(selectedColor = DEFAULT_VALUE_SET_COLOR) {
  ensureValueSetElements();
  if (!elements.valueSetColorOptions) return;
  const container = elements.valueSetColorOptions;
  container.innerHTML = "";
  const groupName = "value-set-form-color";
  const normalizedSelection = getEffectiveValueSetColor(selectedColor);
  VALUE_SET_COLOR_PRESETS.forEach((preset) => {
    const option = createColorOptionElement(groupName, preset, preset.value === normalizedSelection);
    const input = option.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.dataset.role = "value-set-form-color";
    }
    container.appendChild(option);
  });
}

function createPanelController(toggle, panel) {
  if (!toggle || !panel) {
    return null;
  }
  return { toggle, panel };
}

const columnPanelController = createPanelController(elements.filterToggle, elements.filterPanel);
const tagPanelController = createPanelController(elements.tagFilterToggle, elements.tagFilterPanel);
const itemPanelController = createPanelController(elements.itemFilterToggle, elements.itemFilterPanel);

const panelControllers = [columnPanelController, tagPanelController, itemPanelController].filter(Boolean);

function getTagDefinitionById(tagId) {
  if (typeof tagId !== "string" || !tagId) {
    return null;
  }
  const tags = Array.isArray(state.data?.tags) ? state.data.tags : [];
  return tags.find((tag) => tag.id === tagId) ?? null;
}

function getTagDisplayLabel(tagValue) {
  if (typeof tagValue !== "string") {
    return "";
  }
  const trimmed = tagValue.trim();
  if (!trimmed) {
    return "";
  }
  const definition = getTagDefinitionById(trimmed);
  return definition?.label ?? trimmed;
}

function setPanelOpen(controller, show) {
  if (!controller) {
    return;
  }
  controller.panel.hidden = !show;
  controller.toggle.setAttribute("aria-expanded", String(show));
}

function togglePanel(controller) {
  if (!controller) {
    return;
  }
  const willOpen = controller.panel.hidden;
  panelControllers.forEach((entry) => {
    setPanelOpen(entry, entry === controller ? willOpen : false);
  });
}

function closeAllPanels() {
  panelControllers.forEach((controller) => setPanelOpen(controller, false));
}

function init() {
  const stored = safeLoadFromStorage();
  if (stored) {
    state.data = stored;
  }
  state.isReadOnly = loadReadOnlyPreference();
  renderAll();
  bindEvents();
}

function safeLoadFromStorage() {
  try {
    return loadFromStorage();
  } catch (error) {
    console.warn("ローカルストレージの取得に失敗しました", error);
    return null;
  }
}

function syncReadOnlyControl() {
  if (!elements.readOnlyToggle) {
    return;
  }
  elements.readOnlyToggle.checked = Boolean(state.isReadOnly);
}

function isReadOnlyActive() {
  return Boolean(state.isReadOnly);
}

function alertReadOnly() {
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(READONLY_ALERT_MESSAGE);
    return;
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.alert === "function") {
    globalThis.alert(READONLY_ALERT_MESSAGE);
  }
}

const guardReadOnly = createReadOnlyGuard(() => isReadOnlyActive(), alertReadOnly);

function setInteractiveDisabled(element, disabled) {
  if (!element) {
    return;
  }
  if (typeof element.disabled === "boolean") {
    element.disabled = disabled;
  }
  if (disabled) {
    element.setAttribute("aria-disabled", "true");
    element.classList.add("is-readonly-disabled");
  } else {
    element.removeAttribute("aria-disabled");
    element.classList.remove("is-readonly-disabled");
  }
}

function updateReadOnlyUI() {
  const readOnly = isReadOnlyActive();
  if (elements.appRoot) {
    elements.appRoot.classList.toggle("app--readonly", readOnly);
  }
  if (elements.matrixTable) {
    elements.matrixTable.classList.toggle("matrix-table--readonly", readOnly);
  }
  setInteractiveDisabled(elements.loadButton, readOnly);
  setInteractiveDisabled(elements.resetButton, readOnly);
  setInteractiveDisabled(elements.addItemButton, readOnly);
  setInteractiveDisabled(elements.addColumnButton, readOnly);
  setInteractiveDisabled(elements.manageTagsButton, readOnly);
  setInteractiveDisabled(elements.manageValueSetButton, readOnly);
  if (elements.fileInput && typeof elements.fileInput.disabled === "boolean") {
    elements.fileInput.disabled = readOnly;
  }
  const dialogInputs = [
    elements.columnNameInput,
    elements.itemNameInput,
    elements.itemTagInput,
    elements.tagNameInput,
    elements.valueSetInput
  ];
  dialogInputs.forEach((input) => {
    if (input && typeof input.disabled === "boolean") {
      input.disabled = readOnly;
    }
  });
  if (elements.columnSubmitButton) {
    setInteractiveDisabled(elements.columnSubmitButton, readOnly);
  }
  if (elements.itemSubmitButton) {
    setInteractiveDisabled(elements.itemSubmitButton, readOnly);
  }
  if (elements.valueSetSubmitButton) {
    setInteractiveDisabled(elements.valueSetSubmitButton, readOnly);
  }
  if (elements.itemColumnOptions) {
    const checkboxes = elements.itemColumnOptions.querySelectorAll("input[type='checkbox']");
    checkboxes.forEach((checkbox) => {
      if (typeof checkbox.disabled === "boolean") {
        checkbox.disabled = readOnly;
      }
    });
  }
  if (elements.valueSetColorOptions) {
    const radios = elements.valueSetColorOptions.querySelectorAll("input[type='radio']");
    radios.forEach((radio) => {
      if (typeof radio.disabled === "boolean") {
        radio.disabled = readOnly;
      }
    });
  }
  if (elements.tagList) {
    elements.tagList.classList.toggle("tag-list--readonly", readOnly);
    elements.tagList.setAttribute("aria-disabled", String(readOnly));
    const tagButtons = elements.tagList.querySelectorAll("button[data-action]");
    tagButtons.forEach((button) => setInteractiveDisabled(button, readOnly));
    const tagHandles = elements.tagList.querySelectorAll(".tag-row__handle");
    tagHandles.forEach((handle) => {
      const row = handle.closest(".tag-row");
      const isEditing = row?.dataset.editing === "true";
      if (readOnly) {
        setInteractiveDisabled(handle, true);
        handle.setAttribute("draggable", "false");
        handle.classList.add("tag-row__handle--readonly");
      } else {
        handle.classList.remove("is-readonly-disabled", "tag-row__handle--readonly");
        if (isEditing) {
          handle.disabled = true;
          handle.setAttribute("aria-disabled", "true");
        } else {
          handle.disabled = false;
          handle.removeAttribute("aria-disabled");
        }
        handle.setAttribute("draggable", isEditing ? "false" : "true");
      }
    });
  }
  if (elements.valueSetList) {
    elements.valueSetList.classList.toggle("value-set-list--readonly", readOnly);
    elements.valueSetList.setAttribute("aria-disabled", String(readOnly));
    const valueButtons = elements.valueSetList.querySelectorAll("button[data-action]");
    valueButtons.forEach((button) => setInteractiveDisabled(button, readOnly));
    const valueHandles = elements.valueSetList.querySelectorAll(".value-set-row__handle");
    valueHandles.forEach((handle) => {
      const row = handle.closest(".value-set-row");
      const isEditing = row?.dataset.editing === "true";
      if (readOnly) {
        setInteractiveDisabled(handle, true);
        handle.setAttribute("draggable", "false");
        handle.classList.add("value-set-row__handle--readonly");
      } else {
        handle.classList.remove("is-readonly-disabled", "value-set-row__handle--readonly");
        if (isEditing) {
          handle.disabled = true;
          handle.setAttribute("aria-disabled", "true");
        } else {
          handle.disabled = false;
          handle.removeAttribute("aria-disabled");
        }
        handle.setAttribute("draggable", isEditing ? "false" : "true");
      }
    });
  }
  if (elements.tableHead) {
    const headerButtons = elements.tableHead.querySelectorAll(".rename-button, .delete-button");
    headerButtons.forEach((button) => setInteractiveDisabled(button, readOnly));
  }
  if (elements.tableBody) {
    const bodyButtons = elements.tableBody.querySelectorAll(".rename-button, .delete-button");
    bodyButtons.forEach((button) => setInteractiveDisabled(button, readOnly));
    const statusCells = elements.tableBody.querySelectorAll(".status-cell");
    statusCells.forEach((cell) => {
      cell.setAttribute("aria-readonly", String(readOnly));
      if (readOnly) {
        cell.setAttribute("aria-disabled", "true");
        cell.tabIndex = -1;
        cell.classList.add("status-cell--readonly");
      } else {
        cell.removeAttribute("aria-disabled");
        cell.tabIndex = 0;
        cell.classList.remove("status-cell--readonly");
      }
    });
  }
  if (readOnly) {
    state.tagEditingId = null;
    state.valueSetEditingIndex = null;
    if (elements.columnDialog && elements.columnDialog.open) {
      closeColumnDialog();
    }
    if (elements.itemDialog && elements.itemDialog.open) {
      closeItemDialog();
    }
    if (elements.tagDialog && elements.tagDialog.open) {
      closeTagDialog();
    }
    if (elements.valueSetDialog && elements.valueSetDialog.open) {
      closeValueSetDialog();
    }
  }
}

function bindEvents() {
  ensureValueSetElements();
  elements.loadButton.addEventListener("click", (event) => {
    if (guardReadOnly(event)) {
      return;
    }
    elements.fileInput.value = "";
    elements.fileInput.click();
  });

  if (elements.readOnlyToggle) {
    elements.readOnlyToggle.addEventListener("change", handleReadOnlyToggleChange);
  }

  elements.fileInput.addEventListener("change", handleFileSelection);
  elements.saveButton.addEventListener("click", handleSaveJson);
  if (elements.exportCsvButton) {
    elements.exportCsvButton.addEventListener("click", handleExportCsv);
  }
  if (elements.resetButton) {
    elements.resetButton.addEventListener("click", handleResetData);
  }

  closeAllPanels();

  panelControllers.forEach((controller) => {
    controller.toggle.addEventListener("click", () => togglePanel(controller));
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    panelControllers.forEach((controller) => {
      if (controller.panel.hidden) {
        return;
      }
      if (controller.toggle.contains(target) || controller.panel.contains(target)) {
        return;
      }
      setPanelOpen(controller, false);
    });
  });

  elements.selectAllColumns.addEventListener("click", () => {
    setAllColumnsSelected();
  });

  elements.clearAllColumns.addEventListener("click", () => {
    setNoColumnsSelected();
  });

  if (elements.selectAllTags) {
    elements.selectAllTags.addEventListener("click", () => setAllTagsSelected());
  }

  if (elements.clearAllTags) {
    elements.clearAllTags.addEventListener("click", () => setNoTagsSelected());
  }

  if (elements.selectAllItems) {
    elements.selectAllItems.addEventListener("click", () => setAllItemsSelected());
  }

  if (elements.clearAllItems) {
    elements.clearAllItems.addEventListener("click", () => setNoItemsSelected());
  }

  if (elements.addColumnButton) {
    elements.addColumnButton.addEventListener("click", (event) => {
      if (guardReadOnly(event)) {
        return;
      }
      openColumnDialog("add");
    });
  }

  if (elements.addItemButton) {
    elements.addItemButton.addEventListener("click", (event) => {
      if (guardReadOnly(event)) {
        return;
      }
      openItemDialog("add");
    });
  }

  if (elements.columnForm) {
    elements.columnForm.addEventListener("submit", handleColumnFormSubmit);
    elements.columnForm.addEventListener("click", (event) => {
      const target = event.target;
      const action = target instanceof HTMLElement ? target.dataset.action : "";
  if (action === "cancel-column") {
        event.preventDefault();
        closeColumnDialog();
      }
    });
  }

  if (elements.itemForm) {
    elements.itemForm.addEventListener("submit", handleItemFormSubmit);
    elements.itemForm.addEventListener("click", (event) => {
      const target = event.target;
      const action = target instanceof HTMLElement ? target.dataset.action : "";
  if (action === "cancel-item") {
        event.preventDefault();
        closeItemDialog();
      }
    });
  }

  if (elements.manageTagsButton) {
    elements.manageTagsButton.addEventListener("click", (event) => {
      if (guardReadOnly(event)) {
        return;
      }
      openTagDialog();
    });
  }

  if (elements.manageValueSetButton) {
    elements.manageValueSetButton.addEventListener("click", (event) => {
      if (guardReadOnly(event)) {
        return;
      }
      openValueSetDialog();
    });
  }

  if (elements.tagForm) {
    elements.tagForm.addEventListener("submit", handleTagFormSubmit);
  }

  if (elements.valueSetForm) {
    elements.valueSetForm.addEventListener("submit", handleValueSetFormSubmit);
    if (elements.valueSetColorOptions) {
      elements.valueSetColorOptions.addEventListener("change", handleValueSetFormColorChange);
    }
  }

  if (elements.tagDialogCloseButtons && elements.tagDialogCloseButtons.length > 0) {
    elements.tagDialogCloseButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closeTagDialog();
      });
    });
  }

  if (elements.valueSetDialogCloseButtons && elements.valueSetDialogCloseButtons.length > 0) {
    elements.valueSetDialogCloseButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closeValueSetDialog();
      });
    });
  }

  if (elements.tagDialog) {
    elements.tagDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeTagDialog();
    });
  }

  if (elements.valueSetDialog) {
    elements.valueSetDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeValueSetDialog();
    });
  }

  if (elements.tagList) {
    elements.tagList.addEventListener("click", handleTagListClick);
    elements.tagList.addEventListener("dragstart", handleTagDragStart);
    elements.tagList.addEventListener("dragover", handleTagDragOver);
    elements.tagList.addEventListener("dragleave", handleTagDragLeave);
    elements.tagList.addEventListener("drop", handleTagDrop);
    elements.tagList.addEventListener("dragend", handleTagDragEnd);
  }

  if (elements.valueSetList) {
    elements.valueSetList.addEventListener("click", handleValueSetListClick);
    elements.valueSetList.addEventListener("dragstart", handleValueSetDragStart);
    elements.valueSetList.addEventListener("dragover", handleValueSetDragOver);
    elements.valueSetList.addEventListener("dragleave", handleValueSetDragLeave);
    elements.valueSetList.addEventListener("drop", handleValueSetDrop);
    elements.valueSetList.addEventListener("dragend", handleValueSetDragEnd);
  }
}

function handleReadOnlyToggleChange(event) {
  const target = event?.target;
  const isInputElement = typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement;
  const checked = isInputElement ? target.checked : Boolean(target?.checked);
  state.isReadOnly = Boolean(checked);
  saveReadOnlyPreference(state.isReadOnly);
  syncReadOnlyControl();
  updateReadOnlyUI();
  renderAll();
}

function handleFileSelection(event) {
  if (guardReadOnly(event)) {
    if (elements.fileInput) {
      elements.fileInput.value = "";
    }
    return;
  }
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const normalized = normalizeData(parsed);
      state.data = normalized;
      state.selectedColumnIds = null;
      state.selectedTags = null;
      state.selectedItemIds = null;
      state.pendingFocus = null;
      state.tagEditingId = null;
      saveToStorage(state.data);
      closeAllPanels();
      renderAll();
    } catch (error) {
      console.error(error);
      alert("JSONファイルの読み込みに失敗しました。形式を確認してください。");
    }
  };
  reader.onerror = (error) => {
    console.error(error);
    alert("ファイルの読み込み中にエラーが発生しました");
  };
  reader.readAsText(file);
}

function handleResetData(event) {
  if (guardReadOnly(event)) {
    return;
  }
  const confirmed = window.confirm("読み込んだデータを初期状態に戻します。よろしいですか？");
  if (!confirmed) {
    return;
  }
  clearStorage();
  state.data = getDefaultData();
  state.selectedColumnIds = null;
  state.selectedTags = null;
  state.selectedItemIds = null;
  state.pendingFocus = null;
  state.tagEditingId = null;
  closeAllPanels();
  renderAll();
}

function handleSaveJson() {
  try {
    const normalized = normalizeData(state.data);
    const blob = toJsonBlob(normalized);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `check-matrix-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("JSONの保存に失敗しました", error);
    alert("JSONの保存に失敗しました。時間を置いて再度お試しください。\n詳細はコンソールを確認してください。");
  }
}

function handleExportCsv(event) {
  if (event?.preventDefault) {
    event.preventDefault();
  }
  try {
    const tableData = getVisibleTableData();
    const csvContent = createCsvStringFromTableData(tableData);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `check-matrix-${timestamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("CSVの出力に失敗しました", error);
    alert("CSVの出力に失敗しました。時間を置いて再度お試しください。\n詳細はコンソールを確認してください。");
  }
}

function isAllColumnsSelected() {
  return state.selectedColumnIds === null;
}

function isNoColumnSelected() {
  return Array.isArray(state.selectedColumnIds) && state.selectedColumnIds.length === 0;
}

function setAllColumnsSelected() {
  state.selectedColumnIds = null;
  syncColumnCheckboxes();
  renderTable();
}

function setNoColumnsSelected() {
  state.selectedColumnIds = [];
  syncColumnCheckboxes();
  renderTable();
}

function updateFilterActionStates() {
  const allSelected = isAllColumnsSelected();
  const noneSelected = isNoColumnSelected();

  if (elements.selectAllColumns) {
    elements.selectAllColumns.disabled = allSelected;
    elements.selectAllColumns.setAttribute("aria-pressed", String(allSelected));
  }

  if (elements.clearAllColumns) {
    elements.clearAllColumns.disabled = noneSelected;
    elements.clearAllColumns.setAttribute("aria-pressed", String(noneSelected));
  }
}

function renderAll() {
  syncReadOnlyControl();
  renderColumnCheckboxes();
  renderTagCheckboxes();
  renderItemCheckboxes();
  renderTable();
  if (elements.tagDialog && elements.tagDialog.open) {
    renderTagList();
  }
  ensureValueSetElements();
  if (elements.valueSetDialog && elements.valueSetDialog.open) {
    renderValueSetList();
    renderValueSetFormColorOptions(state.valueSetFormColor);
  }
  updateReadOnlyUI();
}

function renderColumnCheckboxes() {
  if (!elements.columnCheckboxes || !elements.checkboxTemplate) return;
  elements.columnCheckboxes.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const templateContent = elements.checkboxTemplate.content;
  state.data.columns.forEach((column) => {
    const template = templateContent.cloneNode(true);
    const label = template.querySelector("label");
    const input = template.querySelector("input[type='checkbox']");
    const span = template.querySelector("span");
    input.value = column.id;
    input.checked = isColumnSelected(column.id);
    input.addEventListener("change", handleColumnSelectionChange);
    span.textContent = column.name;
    if (label) {
      label.dataset.columnId = column.id;
      label.title = column.name;
    }
    fragment.appendChild(template);
  });
  elements.columnCheckboxes.appendChild(fragment);
  updateFilterActionStates();
}

function getTagOptions() {
  const options = [];
  const tagDefinitions = Array.isArray(state.data?.tags) ? state.data.tags : [];
  const items = Array.isArray(state.data?.items) ? state.data.items : [];
  const hasUntaggedItems = items.some((item) => item?.tag == null);

  if (tagDefinitions.length > 0) {
    tagDefinitions.forEach((tag) => {
      options.push({ value: tag.id, label: tag.label });
    });
  } else {
    const seen = new Set();
    items.forEach((item) => {
      const tagValue = typeof item?.tag === "string" ? item.tag : "";
      if (!tagValue) {
        return;
      }
      if (!seen.has(tagValue)) {
        seen.add(tagValue);
        options.push({ value: tagValue, label: tagValue });
      }
    });
  }

  if (hasUntaggedItems) {
    options.push({ value: UNTAGGED_TAG_VALUE, label: "タグ未設定" });
  }

  return options;
}

function isAllTagsSelected() {
  return state.selectedTags === null;
}

function isNoTagsSelected() {
  return Array.isArray(state.selectedTags) && state.selectedTags.length === 0;
}

function isTagSelected(value) {
  if (isAllTagsSelected()) {
    return true;
  }
  return state.selectedTags.includes(value);
}

function setAllTagsSelected() {
  state.selectedTags = null;
  syncTagCheckboxes();
  renderTable();
}

function setNoTagsSelected() {
  state.selectedTags = [];
  syncTagCheckboxes();
  renderTable();
}

function updateTagFilterActionStates(optionCount) {
  const total = optionCount ?? getTagOptions().length;
  const allSelected = isAllTagsSelected();
  const noneSelected = isNoTagsSelected();

  if (elements.selectAllTags) {
    const disabled = allSelected || total === 0;
    elements.selectAllTags.disabled = disabled;
    elements.selectAllTags.setAttribute("aria-pressed", String(allSelected));
  }

  if (elements.clearAllTags) {
    const disabled = noneSelected || total === 0;
    elements.clearAllTags.disabled = disabled;
    elements.clearAllTags.setAttribute("aria-pressed", String(noneSelected));
  }
}

function renderTagCheckboxes() {
  if (!elements.tagCheckboxes || !elements.checkboxTemplate) return;
  const options = getTagOptions();
  elements.tagCheckboxes.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const templateContent = elements.checkboxTemplate.content;
  options.forEach(({ value, label }) => {
    const template = templateContent.cloneNode(true);
    const labelElement = template.querySelector("label");
    const input = template.querySelector("input[type='checkbox']");
    const span = template.querySelector("span");
    input.value = value;
    input.checked = isTagSelected(value);
    input.addEventListener("change", handleTagSelectionChange);
    span.textContent = label;
    if (labelElement) {
      labelElement.dataset.tagValue = value;
      labelElement.title = label;
    }
    fragment.appendChild(template);
  });
  elements.tagCheckboxes.appendChild(fragment);
  updateTagFilterActionStates(options.length);
}

function syncTagCheckboxes() {
  if (!elements.tagCheckboxes) return;
  const inputs = elements.tagCheckboxes.querySelectorAll("input[type='checkbox']");
  inputs.forEach((input) => {
    input.checked = isTagSelected(input.value);
  });
  updateTagFilterActionStates(inputs.length);
}

function handleTagSelectionChange() {
  if (!elements.tagCheckboxes) return;
  const options = getTagOptions();
  const total = options.length;
  const inputs = elements.tagCheckboxes.querySelectorAll("input[type='checkbox']");
  const checkedValues = Array.from(inputs)
    .filter((input) => input.checked)
    .map((input) => input.value);
  if (checkedValues.length === total) {
    state.selectedTags = null;
  } else if (checkedValues.length === 0) {
    state.selectedTags = [];
  } else {
    state.selectedTags = checkedValues;
  }
  syncTagCheckboxes();
  renderTable();
}

function getItemOptions() {
  return state.data.items.map((item) => ({ value: item.id, label: item.name }));
}

function isAllItemsSelected() {
  return state.selectedItemIds === null;
}

function isNoItemsSelected() {
  return Array.isArray(state.selectedItemIds) && state.selectedItemIds.length === 0;
}

function isItemSelected(value) {
  if (isAllItemsSelected()) {
    return true;
  }
  return state.selectedItemIds.includes(value);
}

function setAllItemsSelected() {
  state.selectedItemIds = null;
  syncItemCheckboxes();
  renderTable();
}

function setNoItemsSelected() {
  state.selectedItemIds = [];
  syncItemCheckboxes();
  renderTable();
}

function updateItemFilterActionStates(optionCount) {
  const total = optionCount ?? getItemOptions().length;
  const allSelected = isAllItemsSelected();
  const noneSelected = isNoItemsSelected();

  if (elements.selectAllItems) {
    const disabled = allSelected || total === 0;
    elements.selectAllItems.disabled = disabled;
    elements.selectAllItems.setAttribute("aria-pressed", String(allSelected));
  }

  if (elements.clearAllItems) {
    const disabled = noneSelected || total === 0;
    elements.clearAllItems.disabled = disabled;
    elements.clearAllItems.setAttribute("aria-pressed", String(noneSelected));
  }
}

function renderItemCheckboxes() {
  if (!elements.itemCheckboxes || !elements.checkboxTemplate) return;
  const options = getItemOptions();
  elements.itemCheckboxes.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const templateContent = elements.checkboxTemplate.content;
  options.forEach(({ value, label }) => {
    const template = templateContent.cloneNode(true);
    const labelElement = template.querySelector("label");
    const input = template.querySelector("input[type='checkbox']");
    const span = template.querySelector("span");
    input.value = value;
    input.checked = isItemSelected(value);
    input.addEventListener("change", handleItemSelectionChange);
    span.textContent = label;
    if (labelElement) {
      labelElement.dataset.itemId = value;
      labelElement.title = label;
    }
    fragment.appendChild(template);
  });
  elements.itemCheckboxes.appendChild(fragment);
  updateItemFilterActionStates(options.length);
}

function syncItemCheckboxes() {
  if (!elements.itemCheckboxes) return;
  const inputs = elements.itemCheckboxes.querySelectorAll("input[type='checkbox']");
  inputs.forEach((input) => {
    input.checked = isItemSelected(input.value);
  });
  updateItemFilterActionStates(inputs.length);
}

function handleItemSelectionChange() {
  if (!elements.itemCheckboxes) return;
  const options = getItemOptions();
  const total = options.length;
  const inputs = elements.itemCheckboxes.querySelectorAll("input[type='checkbox']");
  const checkedValues = Array.from(inputs)
    .filter((input) => input.checked)
    .map((input) => input.value);
  if (checkedValues.length === total) {
    state.selectedItemIds = null;
  } else if (checkedValues.length === 0) {
    state.selectedItemIds = [];
  } else {
    state.selectedItemIds = checkedValues;
  }
  syncItemCheckboxes();
  renderTable();
}

function isColumnSelected(columnId) {
  if (isAllColumnsSelected()) {
    return true;
  }
  return state.selectedColumnIds.includes(columnId);
}

function handleColumnSelectionChange() {
  const checkboxes = elements.columnCheckboxes.querySelectorAll("input[type='checkbox']");
  const selected = Array.from(checkboxes)
    .filter((input) => input.checked)
    .map((input) => input.value);
  if (selected.length === state.data.columns.length) {
    state.selectedColumnIds = null;
  } else if (selected.length === 0) {
    state.selectedColumnIds = [];
  } else {
    state.selectedColumnIds = selected;
  }
  syncColumnCheckboxes();
  renderTable();
}

function syncColumnCheckboxes() {
  const checkboxes = elements.columnCheckboxes.querySelectorAll("input[type='checkbox']");
  checkboxes.forEach((input) => {
    input.checked = isColumnSelected(input.value);
  });
  updateFilterActionStates();
}

function getSelectedTagsForMatrix() {
  if (!Array.isArray(state.selectedTags)) {
    return null;
  }
  return state.selectedTags.map((value) => (value === UNTAGGED_TAG_VALUE ? null : value));
}

function getSelectedItemIdsForMatrix() {
  if (!Array.isArray(state.selectedItemIds)) {
    return null;
  }
  return state.selectedItemIds.slice();
}

function renderTable() {
  const matrix = buildMatrix(state.data, {
    selectedColumnIds: state.selectedColumnIds,
    selectedTags: getSelectedTagsForMatrix(),
    selectedItemIds: getSelectedItemIdsForMatrix()
  });
  renderTableHeader(matrix.columns);
  renderTableBody(matrix.rows, matrix.columns);
  toggleEmptyState(matrix.rows.length === 0);
  restorePendingFocus();
}

function getVisibleTableData() {
  const matrix = buildMatrix(state.data, {
    selectedColumnIds: state.selectedColumnIds,
    selectedTags: getSelectedTagsForMatrix(),
    selectedItemIds: getSelectedItemIdsForMatrix()
  });

  const columnHeaders = matrix.columns.map((column) => ({
    id: column.id,
    name: column.name
  }));

  const rows = matrix.rows.map((row) => {
    const rawValues = matrix.columns.map((column, index) => row.values?.[index] ?? null);
    const resolvedValues = rawValues.map((rawValue) => {
      const entry = resolveValueSetEntry(rawValue);
      if (entry) {
        return entry.label ?? "";
      }
      if (rawValue == null) {
        return "";
      }
      return typeof rawValue === "string" ? rawValue : String(rawValue);
    });

    return {
      id: row.id,
      name: row.name,
      tagId: row.tag ?? null,
      tagLabel: row.tagLabel ?? "",
      values: resolvedValues,
      rawValues
    };
  });

  return {
    headers: [
      { id: "__tag__", name: "タグ" },
      { id: "__name__", name: "項目名" },
      ...columnHeaders
    ],
    rows
  };
}

function renderTableHeader(columns) {
  elements.tableHead.innerHTML = "";
  const headerRow = document.createElement("tr");
  const tagHeader = document.createElement("th");
  tagHeader.textContent = "タグ";
  tagHeader.classList.add("matrix-table__tag-header");
  headerRow.appendChild(tagHeader);
  const nameHeader = document.createElement("th");
  nameHeader.textContent = "項目名";
  nameHeader.classList.add("matrix-table__name-header");
  headerRow.appendChild(nameHeader);
  if (columns.length === 0) {
    const placeholder = document.createElement("th");
    placeholder.textContent = "列";
    headerRow.appendChild(placeholder);
  } else {
    columns.forEach((column) => {
      const th = document.createElement("th");
      th.classList.add("matrix-table__column-header");
      const wrapper = document.createElement("span");
      wrapper.classList.add("header-with-actions");
      const label = document.createElement("span");
      label.textContent = column.name;
      wrapper.appendChild(label);
      const actionGroup = document.createElement("span");
      actionGroup.classList.add("action-group");
      actionGroup.appendChild(createColumnRenameButton(column));
      actionGroup.appendChild(createColumnDeleteButton(column));
      wrapper.appendChild(actionGroup);
      th.appendChild(wrapper);
      headerRow.appendChild(th);
    });
  }
  elements.tableHead.appendChild(headerRow);
}

function renderTableBody(rows, columns) {
  elements.tableBody.innerHTML = "";
  if (rows.length === 0) {
    return;
  }
  const readOnly = isReadOnlyActive();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (readOnly) {
      tr.classList.add("matrix-row--readonly");
    }

    const tagCell = document.createElement("td");
    tagCell.appendChild(createTagBadge(row.tag, row.tagLabel));
    if (row.tag != null) {
      tagCell.dataset.tagId = row.tag;
    } else {
      delete tagCell.dataset.tagId;
    }
    tagCell.classList.add("tag-cell");
    tr.appendChild(tagCell);

    const nameCell = document.createElement("td");
    nameCell.classList.add("name-cell");
    const nameWrapper = document.createElement("div");
    nameWrapper.classList.add("cell-with-actions");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = row.name;
    nameWrapper.appendChild(nameSpan);
    const actionGroup = document.createElement("span");
    actionGroup.classList.add("action-group");
    actionGroup.appendChild(createItemRenameButton(row.id, row.name));
    actionGroup.appendChild(createItemDeleteButton(row.id, row.name));
      if (readOnly) {
        actionGroup.classList.add("action-group--disabled");
      }
    nameWrapper.appendChild(actionGroup);
    nameCell.appendChild(nameWrapper);
    tr.appendChild(nameCell);

    if (columns.length === 0) {
      const td = document.createElement("td");
      td.textContent = "-";
      td.colSpan = 1;
      tr.appendChild(td);
    } else {
      columns.forEach((column, columnIndex) => {
        const td = document.createElement("td");
        const value = row.values?.[columnIndex] ?? null;
        const entry = resolveValueSetEntry(value);
        const hasRawValue = value != null;
        const isAssigned = entry != null || hasRawValue;
        const ariaLabel = getCellAriaLabel(column.name, entry ?? value);
        const fallbackLabel = hasRawValue ? (entry ? entry.label : typeof value === "string" ? value : String(value)) : "";
        const displayLabel = entry ? entry.label : fallbackLabel;
        const style = createCellColorStyle(entry);

        td.textContent = displayLabel;
        td.setAttribute("aria-label", ariaLabel);
        td.title = style && entry ? `${ariaLabel} (${style.backgroundColor})` : ariaLabel;
        td.classList.add(isAssigned ? "status-owned" : "status-missing", "status-cell");
        if (readOnly) {
          td.setAttribute("aria-readonly", "true");
          td.classList.add("status-cell--readonly");
        }
        td.dataset.itemId = row.id;
        td.dataset.columnId = column.id;
        if ((entry && entry.label === "") || (!entry && typeof value === "string" && value === "")) {
          td.dataset.emptyString = "true";
        } else {
          delete td.dataset.emptyString;
        }
        if (entry) {
          td.dataset.valueId = entry.id;
        } else {
          delete td.dataset.valueId;
        }
        if (style) {
          td.style.backgroundColor = style.backgroundColor;
        } else {
          td.style.removeProperty("background-color");
        }
        if (style) {
          td.style.color = style.textColor;
        } else {
          td.style.removeProperty("color");
        }
        td.setAttribute("role", "button");
        td.setAttribute("aria-pressed", String(isAssigned));
        td.tabIndex = 0;
        td.addEventListener("click", handleStatusCellActivation);
        td.addEventListener("keydown", handleStatusCellKeyDown);
        tr.appendChild(td);
      });
    }

    elements.tableBody.appendChild(tr);
  });
}

function handleStatusCellActivation(event) {
  if (guardReadOnly(event)) {
    return;
  }
  const cell = event.currentTarget;
  const itemId = cell.dataset.itemId ?? "";
  const columnId = cell.dataset.columnId ?? "";
  if (!itemId || !columnId) {
    return;
  }
  toggleItemValue(itemId, columnId);
}

function handleStatusCellKeyDown(event) {
  if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
    event.preventDefault();
    handleStatusCellActivation(event);
  }
}

function toggleItemValue(itemId, columnId) {
  if (isReadOnlyActive()) {
    return;
  }
  const item = state.data.items.find((entry) => entry.id === itemId);
  if (!item) return;
  const currentValue = item.values?.[columnId] ?? null;
  const nextRawValue = getNextValue(currentValue);
  try {
    const nextData = updateItem(state.data, itemId, {
      values: { [columnId]: nextRawValue }
    });
    const focus = determineFocusTarget(nextData, itemId, [columnId]);
    applyDataUpdate(nextData, { focus });
  } catch (error) {
    console.error(error);
    alert("値の更新に失敗しました");
  }
}

function restorePendingFocus() {
  const target = state.pendingFocus;
  if (!target) {
    return;
  }
  state.pendingFocus = null;
  const selector = `td[data-item-id="${CSS.escape(target.itemId)}"][data-column-id="${CSS.escape(target.columnId)}"]`;
  const cell = elements.tableBody.querySelector(selector);
  if (cell instanceof HTMLElement) {
    cell.focus();
  }
}

function trimInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) {
      try {
        dialog.showModal();
        return;
      } catch (error) {
        console.warn("showModal が失敗したため属性モードにフォールバックします", error);
      }
    } else {
      return;
    }
  }
  dialog.setAttribute("open", "true");
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function openColumnDialog(mode, context = {}) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!elements.columnDialog || !elements.columnNameInput) return;
  const columnId = typeof context.columnId === "string" ? context.columnId : "";
  const columnName = typeof context.columnName === "string" ? context.columnName : "";
  elements.columnDialog.dataset.mode = mode;
  elements.columnDialog.dataset.columnId = columnId;
  if (elements.columnDialogTitle) {
    elements.columnDialogTitle.textContent = mode === "rename" ? "列名の変更" : "列追加";
  }
  if (elements.columnSubmitButton) {
    elements.columnSubmitButton.textContent = mode === "rename" ? "更新" : "追加";
  }
  elements.columnNameInput.value = mode === "rename" ? columnName : "";
  setColumnDialogError("");
  openDialog(elements.columnDialog);
  window.requestAnimationFrame(() => {
    elements.columnNameInput.focus();
    if (mode === "rename") {
      elements.columnNameInput.select();
    }
  });
}

function closeColumnDialog() {
  if (!elements.columnDialog) return;
  elements.columnDialog.dataset.mode = "";
  elements.columnDialog.dataset.columnId = "";
  if (elements.columnNameInput) {
    elements.columnNameInput.value = "";
  }
  setColumnDialogError("");
  closeDialog(elements.columnDialog);
}

function setColumnDialogError(message) {
  if (!elements.columnError) return;
  const text = trimInput(message);
  if (!text) {
    elements.columnError.textContent = "";
    elements.columnError.hidden = true;
    return;
  }
  elements.columnError.textContent = text;
  elements.columnError.hidden = false;
}

function handleColumnFormSubmit(event) {
  event.preventDefault();
  if (guardReadOnly(event)) {
    return;
  }
  if (!elements.columnDialog || !elements.columnNameInput) return;
  const mode = elements.columnDialog.dataset.mode === "rename" ? "rename" : "add";
  const columnId = elements.columnDialog.dataset.columnId ?? "";
  const name = trimInput(elements.columnNameInput.value);
  try {
    if (mode === "rename") {
      const nextData = renameColumn(state.data, columnId, name);
      applyDataUpdate(nextData, { type: "renameColumn", columnId });
    } else {
      const nextData = addColumn(state.data, name);
      applyDataUpdate(nextData);
    }
    closeColumnDialog();
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "列の更新に失敗しました";
    setColumnDialogError(message);
  }
}

function renderItemDialogColumnOptions(selectedColumns = null) {
  if (!elements.itemColumnOptions) return;
  const columns = Array.isArray(state.data?.columns) ? state.data.columns : [];
  elements.itemColumnOptions.innerHTML = "";
  if (columns.length === 0) {
    const empty = document.createElement("p");
    empty.classList.add("item-dialog__no-columns");
    empty.textContent = "列がありません";
    elements.itemColumnOptions.appendChild(empty);
    return;
  }
  const selectedSet = new Set(Array.isArray(selectedColumns) ? selectedColumns : []);
  columns.forEach((column, index) => {
    const label = document.createElement("label");
    label.classList.add("checkbox-item");

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = column.id;
    input.id = `item-column-option-${index}`;
    input.checked = selectedSet.has(column.id);

    const span = document.createElement("span");
    span.textContent = column.name;

    label.appendChild(input);
    label.appendChild(span);
    elements.itemColumnOptions.appendChild(label);
  });
}

function openItemDialog(mode, context = {}) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!elements.itemDialog || !elements.itemNameInput || !elements.itemTagInput) return;
  const itemId = typeof context.itemId === "string" ? context.itemId : "";
  const item = mode === "edit" ? state.data.items.find((entry) => entry.id === itemId) ?? null : null;
  elements.itemDialog.dataset.mode = mode;
  elements.itemDialog.dataset.itemId = item?.id ?? "";
  if (elements.itemDialogTitle) {
    elements.itemDialogTitle.textContent = mode === "edit" ? "項目編集" : "項目追加";
  }
  if (elements.itemSubmitButton) {
    elements.itemSubmitButton.textContent = mode === "edit" ? "保存" : "追加";
  }
  elements.itemNameInput.value = item?.name ?? "";
  elements.itemTagInput.value = item?.tag ? getTagDisplayLabel(item.tag) : "";
  const selectedColumns = item
    ? state.data.columns
        .filter((column) => isCellActive(item.values?.[column.id]))
        .map((column) => column.id)
    : null;
  renderItemDialogColumnOptions(selectedColumns);
  setItemDialogError("");
  openDialog(elements.itemDialog);
  window.requestAnimationFrame(() => {
    elements.itemNameInput.focus();
    if (mode === "edit") {
      elements.itemNameInput.select();
    }
  });
}

function closeItemDialog() {
  if (!elements.itemDialog) return;
  elements.itemDialog.dataset.mode = "";
  elements.itemDialog.dataset.itemId = "";
  if (elements.itemNameInput) {
    elements.itemNameInput.value = "";
  }
  if (elements.itemTagInput) {
    elements.itemTagInput.value = "";
  }
  if (elements.itemColumnOptions) {
    elements.itemColumnOptions.innerHTML = "";
  }
  setItemDialogError("");
  closeDialog(elements.itemDialog);
}

function setItemDialogError(message) {
  if (!elements.itemError) return;
  const text = trimInput(message);
  if (!text) {
    elements.itemError.textContent = "";
    elements.itemError.hidden = true;
    return;
  }
  elements.itemError.textContent = text;
  elements.itemError.hidden = false;
}

function getItemDialogSelectedColumns() {
  if (!elements.itemColumnOptions) return [];
  const inputs = elements.itemColumnOptions.querySelectorAll("input[type='checkbox']");
  return Array.from(inputs)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function setTagDialogError(message) {
  if (!elements.tagDialogError) return;
  const text = trimInput(message);
  if (!text) {
    elements.tagDialogError.textContent = "";
    elements.tagDialogError.hidden = true;
    return;
  }
  elements.tagDialogError.textContent = text;
  elements.tagDialogError.hidden = false;
}

function openTagDialog() {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!elements.tagDialog) return;
  state.tagEditingId = null;
  setTagDialogError("");
  if (elements.tagDialogTitle instanceof HTMLElement) {
    elements.tagDialogTitle.textContent = "タグ設定";
  }
  if (elements.tagNameInput instanceof HTMLInputElement) {
    elements.tagNameInput.value = "";
  }
  renderTagList();
  openDialog(elements.tagDialog);
  window.requestAnimationFrame(() => {
    if (elements.tagNameInput instanceof HTMLInputElement) {
      elements.tagNameInput.focus();
      elements.tagNameInput.select();
    }
  });
}

function closeTagDialog() {
  if (!elements.tagDialog) return;
  state.tagEditingId = null;
  tagDragState.sourceIndex = -1;
  if (elements.tagNameInput instanceof HTMLInputElement) {
    elements.tagNameInput.value = "";
  }
  setTagDialogError("");
  clearTagDragHoverClasses();
  closeDialog(elements.tagDialog);
}

function renderTagList() {
  if (!elements.tagList) return;
  const tags = Array.isArray(state.data?.tags) ? state.data.tags : [];
  elements.tagList.innerHTML = "";

  if (tags.length === 0) {
    const empty = document.createElement("li");
    empty.classList.add("tag-row", "tag-row--empty");
    empty.textContent = "タグが登録されていません";
    empty.setAttribute("aria-live", "polite");
    elements.tagList.appendChild(empty);
    return;
  }

  let focusTargetId = null;

  tags.forEach((tag, index) => {
    const row = document.createElement("li");
    row.classList.add("tag-row");
    row.dataset.tagId = tag.id;
    row.dataset.index = String(index);
    row.setAttribute("draggable", "false");

    const handle = document.createElement("button");
    handle.type = "button";
    handle.classList.add("tag-row__handle");
    handle.setAttribute("aria-label", `${tag.label} をドラッグして並び替え`);
    handle.innerHTML = "<span aria-hidden=\"true\">☰</span>";
    handle.draggable = true;
  handle.setAttribute("draggable", "true");

    const actions = document.createElement("div");
    actions.classList.add("tag-row__actions");

    if (state.tagEditingId === tag.id) {
      row.dataset.editing = "true";
      handle.draggable = false;
      handle.setAttribute("draggable", "false");
      handle.setAttribute("aria-disabled", "true");
      handle.disabled = true;

      const input = document.createElement("input");
      input.type = "text";
      input.value = tag.label;
      input.classList.add("tag-row__input");
      input.dataset.tagInput = tag.id;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleTagRename(tag.id);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelTagEdit();
        }
      });

      const save = document.createElement("button");
      save.type = "button";
      save.classList.add("link-button", "tag-row__save");
      save.dataset.action = "save-tag";
      save.dataset.tagId = tag.id;
      save.textContent = "保存";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.classList.add("link-button", "tag-row__cancel");
      cancel.dataset.action = "cancel-tag";
      cancel.dataset.tagId = tag.id;
      cancel.textContent = "キャンセル";

      actions.appendChild(save);
      actions.appendChild(cancel);

      row.appendChild(handle);
      row.appendChild(input);
      row.appendChild(actions);
      focusTargetId = tag.id;
    } else {
      handle.removeAttribute("aria-disabled");
      const label = document.createElement("span");
      label.classList.add("tag-row__label");
      label.textContent = tag.label;

      const edit = document.createElement("button");
      edit.type = "button";
      edit.classList.add("link-button", "tag-row__edit");
      edit.dataset.action = "edit-tag";
      edit.dataset.tagId = tag.id;
      edit.textContent = "編集";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.classList.add("link-button", "tag-row__delete");
      removeButton.dataset.action = "delete-tag";
      removeButton.dataset.tagId = tag.id;
      removeButton.textContent = "削除";

      actions.appendChild(edit);
      actions.appendChild(removeButton);

      row.appendChild(handle);
      row.appendChild(label);
      row.appendChild(actions);
    }

    elements.tagList.appendChild(row);
  });

  if (focusTargetId) {
    window.requestAnimationFrame(() => {
      const selector = `[data-tag-input='${CSS.escape(focusTargetId)}']`;
      const input = elements.tagList?.querySelector(selector);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    });
  }
}

function handleTagFormSubmit(event) {
  event.preventDefault();
  if (guardReadOnly(event)) {
    return;
  }
  if (!(elements.tagNameInput instanceof HTMLInputElement)) {
    return;
  }
  const label = trimInput(elements.tagNameInput.value);
  try {
    const nextData = addTag(state.data, label);
    applyDataUpdate(nextData);
    elements.tagNameInput.value = "";
    setTagDialogError("");
    renderTagList();
    window.requestAnimationFrame(() => {
      elements.tagNameInput?.focus();
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "タグの追加に失敗しました";
    setTagDialogError(message);
  }
}

function handleTagListClick(event) {
  const target = event.target instanceof HTMLElement ? event.target.closest("button[data-action]") : null;
  if (!target) {
    return;
  }
  const action = target.dataset.action ?? "";
  const tagId = target.dataset.tagId ?? target.closest(".tag-row")?.dataset.tagId ?? "";
  switch (action) {
    case "edit-tag":
      if (guardReadOnly(event)) {
        return;
      }
      enterTagEditMode(tagId);
      break;
    case "cancel-tag":
      cancelTagEdit();
      break;
    case "save-tag":
      if (guardReadOnly(event)) {
        return;
      }
      handleTagRename(tagId);
      break;
    case "delete-tag":
      if (guardReadOnly(event)) {
        return;
      }
      handleTagDeletion(tagId);
      break;
    default:
      break;
  }
}

function enterTagEditMode(tagId) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!tagId) return;
  state.tagEditingId = tagId;
  setTagDialogError("");
  renderTagList();
}

function cancelTagEdit() {
  state.tagEditingId = null;
  setTagDialogError("");
  renderTagList();
}

function handleTagRename(tagId) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!tagId) return;
  const selector = `[data-tag-input='${CSS.escape(tagId)}']`;
  const input = elements.tagList?.querySelector(selector);
  const value = input instanceof HTMLInputElement ? trimInput(input.value) : "";
  try {
    const nextData = updateTag(state.data, tagId, value);
    state.tagEditingId = null;
    applyDataUpdate(nextData);
    setTagDialogError("");
    renderTagList();
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "タグ名の更新に失敗しました";
    setTagDialogError(message);
    if (input instanceof HTMLInputElement) {
      window.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
  }
}

function handleTagDeletion(tagId) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!tagId) return;
  const definition = getTagDefinitionById(tagId);
  const label = definition?.label ?? "指定のタグ";
  const usageCount = Array.isArray(state.data?.items)
    ? state.data.items.filter((item) => {
        if (!item) return false;
        const tagMatches = item.tag === tagId;
        const tagsArrayMatches = Array.isArray(item.tags) && item.tags.includes(tagId);
        return tagMatches || tagsArrayMatches;
      }).length
    : 0;
  const message = usageCount > 0
    ? `タグ「${label}」は ${usageCount} 件の項目で使用されています。削除しますか？`
    : `タグ「${label}」を削除しますか？`;
  const confirmed = window.confirm(message);
  if (!confirmed) {
    return;
  }
  try {
    const nextData = deleteTag(state.data, tagId);
    state.tagEditingId = null;
    applyDataUpdate(nextData);
    setTagDialogError("");
    renderTagList();
  } catch (error) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : "タグの削除に失敗しました";
    setTagDialogError(errorMessage);
  }
}

function clearTagDragHoverClasses() {
  if (!elements.tagList) return;
  elements.tagList
    .querySelectorAll(".tag-row--dragover-before, .tag-row--dragover-after")
    .forEach((row) => row.classList.remove("tag-row--dragover-before", "tag-row--dragover-after"));
}

function handleTagDragStart(event) {
  if (guardReadOnly(event)) {
    return;
  }
  const handle = event.target instanceof HTMLElement ? event.target.closest(".tag-row__handle") : null;
  if (!handle) {
    return;
  }
  const row = handle.closest(".tag-row");
  if (!row || row.dataset.editing === "true") {
    event.preventDefault();
    return;
  }
  const index = Number(row.dataset.index);
  if (!Number.isInteger(index)) {
    event.preventDefault();
    return;
  }
  tagDragState.sourceIndex = index;
  clearTagDragHoverClasses();
  row.classList.add("tag-row--dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.tagId ?? "");
  }
}

function handleTagDragOver(event) {
  if (isReadOnlyActive()) {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    return;
  }
  if (tagDragState.sourceIndex === -1) {
    return;
  }
  const row = event.target instanceof HTMLElement ? event.target.closest(".tag-row") : null;
  if (!row || row.dataset.editing === "true" || row.classList.contains("tag-row--empty")) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    clearTagDragHoverClasses();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  clearTagDragHoverClasses();
  row.classList.add(after ? "tag-row--dragover-after" : "tag-row--dragover-before");
}

function handleTagDragLeave(event) {
  const row = event.target instanceof HTMLElement ? event.target.closest(".tag-row") : null;
  if (!row) {
    return;
  }
  row.classList.remove("tag-row--dragover-before", "tag-row--dragover-after");
}

function handleTagDrop(event) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    if (event?.preventDefault) {
      event.preventDefault();
    }
    resetTagDragState();
    return;
  }
  if (tagDragState.sourceIndex === -1) {
    return;
  }
  event.preventDefault();
  const tags = Array.isArray(state.data?.tags) ? state.data.tags : [];
  const row = event.target instanceof HTMLElement ? event.target.closest(".tag-row") : null;
  let rawIndex = tags.length;
  if (row && row.dataset.index && !row.classList.contains("tag-row--empty")) {
    const index = Number(row.dataset.index);
    if (Number.isInteger(index)) {
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      rawIndex = after ? index + 1 : index;
    }
  }
  const ids = tags.map((tag) => tag.id);
  const fromIndex = tagDragState.sourceIndex;
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= ids.length) {
    resetTagDragState();
    return;
  }
  const [movedId] = ids.splice(fromIndex, 1);
  const insertionIndex = Math.min(Math.max(rawIndex, 0), ids.length);
  ids.splice(insertionIndex, 0, movedId);
  const finalIndex = ids.indexOf(movedId);
  if (finalIndex === fromIndex || finalIndex === -1) {
    resetTagDragState();
    renderTagList();
    return;
  }
  try {
    const nextData = reorderTags(state.data, fromIndex, finalIndex);
    applyDataUpdate(nextData);
    setTagDialogError("");
    renderTagList();
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "タグの並び替えに失敗しました";
    setTagDialogError(message);
  } finally {
    resetTagDragState();
  }
}

function handleTagDragEnd() {
  resetTagDragState();
}

function resetTagDragState() {
  tagDragState.sourceIndex = -1;
  clearTagDragHoverClasses();
  if (!elements.tagList) return;
  elements.tagList.querySelectorAll(".tag-row--dragging").forEach((row) => {
    row.classList.remove("tag-row--dragging");
  });
}

function setValueSetError(message) {
  ensureValueSetElements();
  if (!elements.valueSetError) return;
  const text = trimInput(message);
  if (!text) {
    elements.valueSetError.textContent = "";
    elements.valueSetError.hidden = true;
    return;
  }
  elements.valueSetError.textContent = text;
  elements.valueSetError.hidden = false;
}

function openValueSetDialog() {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  ensureValueSetElements();
  if (!elements.valueSetDialog) return;
  state.valueSetEditingIndex = null;
  state.valueSetPendingFocusIndex = null;
  state.valueSetFormColor = DEFAULT_VALUE_SET_COLOR;
  setValueSetError("");
  if (elements.valueSetInput instanceof HTMLInputElement) {
    elements.valueSetInput.value = "";
  }
  renderValueSetList();
  renderValueSetFormColorOptions(state.valueSetFormColor);
  openDialog(elements.valueSetDialog);
  window.requestAnimationFrame(() => {
    if (elements.valueSetInput instanceof HTMLInputElement) {
      elements.valueSetInput.focus();
      elements.valueSetInput.select();
    }
  });
}

function closeValueSetDialog() {
  ensureValueSetElements();
  if (!elements.valueSetDialog) return;
  state.valueSetEditingIndex = null;
  state.valueSetPendingFocusIndex = null;
  state.valueSetFormColor = DEFAULT_VALUE_SET_COLOR;
  valueSetDragState.sourceIndex = -1;
  clearValueSetDragHoverClasses();
  setValueSetError("");
  if (elements.valueSetInput instanceof HTMLInputElement) {
    elements.valueSetInput.value = "";
  }
  closeDialog(elements.valueSetDialog);
}

function renderValueSetList() {
  ensureValueSetElements();
  if (!elements.valueSetList) return;
  const values = getValueSetEntries();
  const normalizedLength = values.length;
  const editingIndex = typeof state.valueSetEditingIndex === "number" ? state.valueSetEditingIndex : null;
  if (editingIndex != null && (editingIndex < 0 || editingIndex >= normalizedLength)) {
    state.valueSetEditingIndex = null;
  }
  const pendingFocusIndex = typeof state.valueSetPendingFocusIndex === "number" ? state.valueSetPendingFocusIndex : null;
  if (pendingFocusIndex != null && (pendingFocusIndex < 0 || pendingFocusIndex >= normalizedLength)) {
    state.valueSetPendingFocusIndex = null;
  }

  elements.valueSetList.innerHTML = "";

  if (values.length === 0) {
    const empty = document.createElement("li");
    empty.classList.add("value-set-row", "value-set-row--empty");
    empty.textContent = "値が登録されていません";
    empty.setAttribute("aria-live", "polite");
    elements.valueSetList.appendChild(empty);
    return;
  }

  values.forEach((entry, index) => {
    const row = document.createElement("li");
    row.classList.add("value-set-row");
    row.dataset.index = String(index);
    if (entry?.id) {
      row.dataset.valueId = entry.id;
    } else {
      delete row.dataset.valueId;
    }
    const colorValue = entry ? getEffectiveValueSetColor(entry.color) : DEFAULT_VALUE_SET_COLOR;
    row.dataset.color = colorValue;
    row.setAttribute("draggable", "false");

    const handle = document.createElement("button");
    handle.type = "button";
    handle.classList.add("value-set-row__handle");
    const description = getValueSetAriaDescription(entry);
    handle.setAttribute("aria-label", `${description} をドラッグして並び替え`);
    handle.innerHTML = "<span aria-hidden=\"true\">☰</span>";
    handle.draggable = true;
    handle.setAttribute("draggable", "true");

    const actions = document.createElement("div");
    actions.classList.add("value-set-row__actions");

    if (state.valueSetEditingIndex === index) {
      row.dataset.editing = "true";
      handle.draggable = false;
      handle.disabled = true;
      handle.setAttribute("aria-disabled", "true");
      handle.setAttribute("draggable", "false");

      const input = document.createElement("input");
      input.type = "text";
      input.value = entry?.label ?? "";
      input.classList.add("value-set-row__input");
      input.dataset.valueInput = String(index);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleValueSetRename(index);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelValueSetEdit();
        }
      });

      const save = document.createElement("button");
      save.type = "button";
      save.classList.add("link-button", "value-set-row__save");
      save.dataset.action = "save-value";
      save.dataset.index = String(index);
      save.textContent = "保存";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.classList.add("link-button", "value-set-row__cancel");
      cancel.dataset.action = "cancel-value";
      cancel.textContent = "キャンセル";

      actions.appendChild(save);
      actions.appendChild(cancel);

      const editBody = document.createElement("div");
      editBody.classList.add("value-set-row__edit-body");

      const colorPreview = document.createElement("div");
      colorPreview.classList.add("value-set-row__color-readonly");

      const colorChip = document.createElement("span");
      colorChip.classList.add("value-set-row__color-chip");
      colorChip.style.backgroundColor = colorValue;
      colorChip.setAttribute("aria-hidden", "true");

      const colorCode = document.createElement("span");
      colorCode.classList.add("value-set-row__color-code");
      colorCode.textContent = colorValue;

      colorPreview.appendChild(colorChip);
      colorPreview.appendChild(colorCode);

      editBody.appendChild(colorPreview);
      editBody.appendChild(input);

      row.appendChild(handle);
      row.appendChild(editBody);
      row.appendChild(actions);
    } else {
      handle.removeAttribute("aria-disabled");

      const label = document.createElement("span");
      label.classList.add("value-set-row__label");
      label.title = `${description} / ${colorValue}`;

      const colorChip = document.createElement("span");
      colorChip.classList.add("value-set-row__color-chip");
      colorChip.style.backgroundColor = colorValue;
      colorChip.setAttribute("aria-hidden", "true");

      const labelText = document.createElement("span");
      labelText.classList.add("value-set-row__label-text");
      labelText.textContent = getValueSetDisplayLabel(entry);

      label.appendChild(colorChip);
      label.appendChild(labelText);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.classList.add("link-button", "value-set-row__edit");
      edit.dataset.action = "edit-value";
      edit.dataset.index = String(index);
      edit.textContent = "編集";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.classList.add("link-button", "value-set-row__delete");
      remove.dataset.action = "delete-value";
      remove.dataset.index = String(index);
      remove.textContent = "削除";

      actions.appendChild(edit);
      actions.appendChild(remove);

      row.appendChild(handle);
      row.appendChild(label);
      row.appendChild(actions);
    }

    elements.valueSetList.appendChild(row);
  });

  if (typeof state.valueSetEditingIndex === "number" && state.valueSetEditingIndex >= 0) {
    const targetIndex = state.valueSetEditingIndex;
    window.requestAnimationFrame(() => {
      const selector = `[data-value-input='${CSS.escape(String(targetIndex))}']`;
      const input = elements.valueSetList?.querySelector(selector);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    });
    return;
  }

  if (typeof state.valueSetPendingFocusIndex === "number" && state.valueSetPendingFocusIndex >= 0) {
    const targetIndex = state.valueSetPendingFocusIndex;
    state.valueSetPendingFocusIndex = null;
    window.requestAnimationFrame(() => {
      const selector = `.value-set-row[data-index='${CSS.escape(String(targetIndex))}'] .value-set-row__handle`;
      const handle = elements.valueSetList?.querySelector(selector);
      if (handle instanceof HTMLElement) {
        handle.focus();
      }
    });
  }
}

function handleValueSetFormSubmit(event) {
  event.preventDefault();
  if (guardReadOnly(event)) {
    return;
  }
  ensureValueSetElements();
  if (!(elements.valueSetInput instanceof HTMLInputElement)) {
    return;
  }
  const rawValue = elements.valueSetInput.value;
  const selectedColor = getEffectiveValueSetColor(state.valueSetFormColor);
  try {
    const nextData = addValueSetEntry(state.data, {
      label: rawValue,
      color: selectedColor
    });
    state.valueSetEditingIndex = null;
    state.valueSetPendingFocusIndex = nextData.valueSet.length - 1;
    applyDataUpdate(nextData);
    elements.valueSetInput.value = "";
    setValueSetError("");
    renderValueSetFormColorOptions(state.valueSetFormColor);
    window.requestAnimationFrame(() => {
      elements.valueSetInput?.focus();
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "値の追加に失敗しました";
    setValueSetError(message);
  }
}

function handleValueSetFormColorChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.dataset.role !== "value-set-form-color") {
    return;
  }
  state.valueSetFormColor = getEffectiveValueSetColor(target.value);
}

function handleValueSetListClick(event) {
  ensureValueSetElements();
  const target = event.target instanceof HTMLElement ? event.target.closest("button[data-action]") : null;
  if (!target) {
    return;
  }
  const action = target.dataset.action ?? "";
  const rawIndex = target.dataset.index ?? target.closest(".value-set-row")?.dataset.index ?? "";
  const index = Number(rawIndex);
  switch (action) {
    case "edit-value":
      if (guardReadOnly(event)) {
        return;
      }
      if (Number.isInteger(index)) {
        enterValueSetEditMode(index);
      }
      break;
    case "cancel-value":
      cancelValueSetEdit();
      break;
    case "save-value":
      if (guardReadOnly(event)) {
        return;
      }
      if (Number.isInteger(index)) {
        handleValueSetRename(index);
      }
      break;
    case "delete-value":
      if (guardReadOnly(event)) {
        return;
      }
      if (Number.isInteger(index)) {
        handleValueSetDeletion(index);
      }
      break;
    default:
      break;
  }
}

function enterValueSetEditMode(index) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!Number.isInteger(index)) return;
  state.valueSetEditingIndex = index;
  state.valueSetPendingFocusIndex = null;
  const values = getValueSetEntries();
  const entry = values[index] ?? null;
  setValueSetError("");
  renderValueSetList();
}

function cancelValueSetEdit() {
  ensureValueSetElements();
  state.valueSetEditingIndex = null;
  setValueSetError("");
  renderValueSetList();
}

function handleValueSetRename(index) {
  ensureValueSetElements();
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!Number.isInteger(index)) return;
  const selector = `[data-value-input='${CSS.escape(String(index))}']`;
  const input = elements.valueSetList?.querySelector(selector);
  const rawValue = input instanceof HTMLInputElement ? input.value : "";
  const values = getValueSetEntries();
  const currentEntry = values[index] ?? null;
  try {
    const nextData = updateValueSetEntry(state.data, index, {
      label: rawValue,
      color: getEffectiveValueSetColor(currentEntry?.color)
    });
    state.valueSetEditingIndex = null;
    state.valueSetPendingFocusIndex = index;
    applyDataUpdate(nextData);
    setValueSetError("");
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "値の更新に失敗しました";
    setValueSetError(message);
    if (input instanceof HTMLInputElement) {
      window.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
  }
}

function handleValueSetDeletion(index) {
  ensureValueSetElements();
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  if (!Number.isInteger(index)) return;
  const values = getValueSetEntries();
  const currentValue = values[index] ?? null;
  const display = getValueSetDisplayLabel(currentValue);
  const confirmed = window.confirm(`値「${display}」を削除しますか？使用中のセルは未設定になります。`);
  if (!confirmed) {
    return;
  }
  try {
    const nextData = removeValueSetEntry(state.data, index);
    state.valueSetEditingIndex = null;
    const nextLength = nextData.valueSet.length;
    state.valueSetPendingFocusIndex = nextLength > 0 ? Math.min(index, nextLength - 1) : null;
    applyDataUpdate(nextData);
    setValueSetError("");
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "値の削除に失敗しました";
    setValueSetError(message);
  }
}

function clearValueSetDragHoverClasses() {
  ensureValueSetElements();
  if (!elements.valueSetList) return;
  elements.valueSetList
    .querySelectorAll(".value-set-row--dragover-before, .value-set-row--dragover-after")
    .forEach((row) => row.classList.remove("value-set-row--dragover-before", "value-set-row--dragover-after"));
}

function handleValueSetDragStart(event) {
  if (guardReadOnly(event)) {
    return;
  }
  ensureValueSetElements();
  const handle = event.target instanceof HTMLElement ? event.target.closest(".value-set-row__handle") : null;
  if (!handle) {
    return;
  }
  const row = handle.closest(".value-set-row");
  if (!row || row.dataset.editing === "true") {
    event.preventDefault();
    return;
  }
  if (row.classList.contains("value-set-row--empty")) {
    event.preventDefault();
    return;
  }
  const index = Number(row.dataset.index);
  if (!Number.isInteger(index)) {
    event.preventDefault();
    return;
  }
  valueSetDragState.sourceIndex = index;
  clearValueSetDragHoverClasses();
  row.classList.add("value-set-row--dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.valueId ?? "");
  }
}

function handleValueSetDragOver(event) {
  if (isReadOnlyActive()) {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    return;
  }
  ensureValueSetElements();
  if (valueSetDragState.sourceIndex === -1) {
    return;
  }
  const row = event.target instanceof HTMLElement ? event.target.closest(".value-set-row") : null;
  if (!row || row.dataset.editing === "true" || row.classList.contains("value-set-row--empty")) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    clearValueSetDragHoverClasses();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  clearValueSetDragHoverClasses();
  row.classList.add(after ? "value-set-row--dragover-after" : "value-set-row--dragover-before");
}

function handleValueSetDragLeave(event) {
  ensureValueSetElements();
  const row = event.target instanceof HTMLElement ? event.target.closest(".value-set-row") : null;
  if (!row) {
    return;
  }
  row.classList.remove("value-set-row--dragover-before", "value-set-row--dragover-after");
}

function handleValueSetDrop(event) {
  if (isReadOnlyActive()) {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    alertReadOnly();
    resetValueSetDragState();
    return;
  }
  ensureValueSetElements();
  if (valueSetDragState.sourceIndex === -1) {
    return;
  }
  event.preventDefault();
  const values = Array.isArray(state.data?.valueSet) ? state.data.valueSet : [];
  const row = event.target instanceof HTMLElement ? event.target.closest(".value-set-row") : null;
  let rawIndex = values.length;
  if (row && row.dataset.index && !row.classList.contains("value-set-row--empty")) {
    const index = Number(row.dataset.index);
    if (Number.isInteger(index)) {
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      rawIndex = after ? index + 1 : index;
    }
  }
  const fromIndex = valueSetDragState.sourceIndex;
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= values.length) {
    resetValueSetDragState();
    return;
  }
  const tempValues = values.slice();
  const [moved] = tempValues.splice(fromIndex, 1);
  const insertionIndex = Math.min(Math.max(rawIndex, 0), tempValues.length);
  tempValues.splice(insertionIndex, 0, moved);
  const finalIndex = tempValues.indexOf(moved);
  if (finalIndex === fromIndex || finalIndex === -1) {
    resetValueSetDragState();
    renderValueSetList();
    return;
  }
  try {
    const nextData = reorderValueSet(state.data, fromIndex, finalIndex);
    state.valueSetPendingFocusIndex = finalIndex;
    applyDataUpdate(nextData);
    setValueSetError("");
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "値の並び替えに失敗しました";
    setValueSetError(message);
  } finally {
    resetValueSetDragState();
  }
}

function handleValueSetDragEnd() {
  ensureValueSetElements();
  resetValueSetDragState();
}

function resetValueSetDragState() {
  ensureValueSetElements();
  valueSetDragState.sourceIndex = -1;
  clearValueSetDragHoverClasses();
  if (!elements.valueSetList) return;
  elements.valueSetList.querySelectorAll(".value-set-row--dragging").forEach((row) => {
    row.classList.remove("value-set-row--dragging");
  });
}

function determineFocusTarget(data, itemId, preferredColumnIds = []) {
  if (!itemId) {
    return null;
  }
  const item = data.items.find((entry) => entry.id === itemId);
  if (!item) {
    return null;
  }
  if (data.columns.length === 0) {
    return null;
  }
  const candidates = preferredColumnIds.length > 0 ? preferredColumnIds : data.columns.map((column) => column.id);
  const columnId = candidates.find((id) => data.columns.some((column) => column.id === id)) ?? data.columns[0].id;
  if (!columnId) {
    return null;
  }
  return { itemId, columnId };
}

function handleItemFormSubmit(event) {
  event.preventDefault();
  if (guardReadOnly(event)) {
    return;
  }
  if (!elements.itemDialog) return;
  const mode = elements.itemDialog.dataset.mode === "edit" ? "edit" : "add";
  const itemId = elements.itemDialog.dataset.itemId ?? "";
  const name = trimInput(elements.itemNameInput?.value ?? "");
  const tagInput = trimInput(elements.itemTagInput?.value ?? "");
  const selectedColumns = getItemDialogSelectedColumns();
  try {
    if (mode === "edit" && itemId) {
      const nextData = updateItem(state.data, itemId, {
        name,
        tag: tagInput || null,
        columns: selectedColumns
      });
      const focus = determineFocusTarget(nextData, itemId, selectedColumns);
      applyDataUpdate(nextData, { focus });
    } else {
      const nextData = addItem(state.data, {
        name,
        tag: tagInput || null,
        columns: selectedColumns
      });
      const nextItem = nextData.items.find((entry) => entry.name === name) ?? null;
      const focus = nextItem ? determineFocusTarget(nextData, nextItem.id, selectedColumns) : null;
      applyDataUpdate(nextData, { focus });
    }
    closeItemDialog();
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "項目の更新に失敗しました";
    setItemDialogError(message);
  }
}

function adjustSelectedColumns(previousColumns, nextColumns, change = {}) {
  if (!Array.isArray(state.selectedColumnIds)) {
    return;
  }
  let selection = [...state.selectedColumnIds];
  if (change.type === "removeColumn" && change.removed) {
    selection = selection.filter((id) => id !== change.removed);
  }
  const nextIds = nextColumns.map((column) => column.id);
  selection = selection.filter((id) => nextIds.includes(id));
  if (selection.length === nextIds.length && nextIds.length > 0) {
    state.selectedColumnIds = null;
    return;
  }
  state.selectedColumnIds = selection;
}

function getAvailableTagValues(items) {
  const values = new Set();
  const tagDefinitions = Array.isArray(state.data?.tags) ? state.data.tags : [];

  if (tagDefinitions.length > 0) {
    tagDefinitions.forEach((tag) => {
      values.add(tag.id);
    });
  } else {
    items.forEach((item) => {
      if (typeof item?.tag === "string" && item.tag) {
        values.add(item.tag);
      }
    });
  }

  if (items.some((item) => item?.tag == null)) {
    values.add(UNTAGGED_TAG_VALUE);
  }

  return values;
}

function adjustSelectedTags(nextItems) {
  if (!Array.isArray(state.selectedTags)) {
    return;
  }
  const available = getAvailableTagValues(nextItems);
  if (available.size === 0) {
    state.selectedTags = null;
    return;
  }
  const filtered = state.selectedTags.filter((value) => available.has(value));
  if (filtered.length === 0 || filtered.length === available.size) {
    state.selectedTags = null;
  } else {
    state.selectedTags = filtered;
  }
}

function getAvailableItemIds(items) {
  return new Set(items.map((item) => item.id));
}

function adjustSelectedItemIds(nextItems) {
  if (!Array.isArray(state.selectedItemIds)) {
    return;
  }
  const available = getAvailableItemIds(nextItems);
  if (available.size === 0) {
    state.selectedItemIds = null;
    return;
  }
  const filtered = state.selectedItemIds.filter((id) => available.has(id));
  if (filtered.length === 0 || filtered.length === available.size) {
    state.selectedItemIds = null;
  } else {
    state.selectedItemIds = filtered;
  }
}

function applyDataUpdate(nextData, options = {}) {
  if (isReadOnlyActive()) {
    console.warn("読み取り専用モード中のため、データ更新をスキップしました。");
    return;
  }
  const previousColumns = state.data?.columns ?? [];
  state.data = normalizeData(nextData);
  adjustSelectedColumns(previousColumns, state.data.columns ?? [], options);
  adjustSelectedTags(state.data.items ?? []);
  adjustSelectedItemIds(state.data.items ?? []);
  state.pendingFocus = options.focus ?? null;
  try {
    saveToStorage(state.data);
  } catch (error) {
    console.warn("ローカルストレージへの保存に失敗しました", error);
  }
  renderAll();
  if (elements.itemDialog && elements.itemDialog.open) {
    const selected = getItemDialogSelectedColumns();
    renderItemDialogColumnOptions(selected);
  }
  if (elements.tagDialog && elements.tagDialog.open) {
    renderTagList();
  }
  if (elements.valueSetDialog && elements.valueSetDialog.open) {
    renderValueSetList();
  }
}

function createColumnRenameButton(column) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("rename-button");
  button.setAttribute("aria-label", `${column.name} 列の名前を変更`);
  button.textContent = "✎";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (guardReadOnly(event)) {
      return;
    }
    openColumnDialog("rename", { columnId: column.id, columnName: column.name });
  });
  return button;
}

function createItemRenameButton(itemId, itemName) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("rename-button");
  button.setAttribute("aria-label", `${itemName} の情報を編集`);
  button.textContent = "✎";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openItemDialog("edit", { itemId });
  });
  return button;
}

function createColumnDeleteButton(column) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("delete-button");
  button.setAttribute("aria-label", `${column.name} 列を削除`);
  button.textContent = "✕";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handleColumnDeletion(column);
  });
  return button;
}

function createItemDeleteButton(itemId, itemName) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("delete-button");
  button.setAttribute("aria-label", `${itemName} を削除`);
  button.textContent = "✕";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handleItemDeletion(itemId, itemName);
  });
  return button;
}

function handleColumnDeletion(column) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  const confirmed = window.confirm(`${column.name} 列を削除しますか？この列のチェック状況も削除されます。`);
  if (!confirmed) {
    return;
  }
  try {
    const nextData = removeColumn(state.data, column.id);
    applyDataUpdate(nextData, { type: "removeColumn", removed: column.id });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "列の削除に失敗しました";
    alert(message);
  }
}

function handleItemDeletion(itemId, itemName) {
  if (isReadOnlyActive()) {
    alertReadOnly();
    return;
  }
  const confirmed = window.confirm(`${itemName} を削除しますか？`);
  if (!confirmed) {
    return;
  }
  try {
    const itemIndex = state.data.items.findIndex((item) => item.id === itemId);
    const nextData = removeItem(state.data, itemId);
    const fallbackItem = nextData.items[Math.min(itemIndex, nextData.items.length - 1)] ?? null;
    const focus = fallbackItem ? determineFocusTarget(nextData, fallbackItem.id) : null;
    applyDataUpdate(nextData, { focus });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "項目の削除に失敗しました";
    alert(message);
  }
}

function createTagBadge(tagId, displayLabel) {
  const span = document.createElement("span");
  span.classList.add("tag-badge");
  const label = typeof displayLabel === "string" ? displayLabel.trim() : "";
  const hasTag = label.length > 0;
  if (!hasTag) {
    span.textContent = "未設定";
    span.dataset.tag = "unknown";
    span.classList.add("tag-badge--unknown");
    if (typeof tagId === "string" && tagId) {
      span.dataset.tagId = tagId;
    }
    return span;
  }
  const key = label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  span.textContent = label;
  span.dataset.tag = key || "custom";
  if (typeof tagId === "string" && tagId) {
    span.dataset.tagId = tagId;
  }
  span.classList.add("tag-badge--" + (key || "custom"));
  return span;
}

function toggleEmptyState(shouldShow) {
  elements.emptyState.hidden = !shouldShow;
}

window.addEventListener("DOMContentLoaded", init);
