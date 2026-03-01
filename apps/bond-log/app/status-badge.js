// BondLog ステータスバッジモジュール
// ステータス定義の検索・バッジ要素の生成

import { state } from "./state.js";
import { parseIsoDateTime, nameCollator } from "./utils.js";

// --- ステータス検索 ---

/**
 * ステータスIDから定義を取得する（未定義の場合は null）
 */
export const getStatusDefinitionById = statusId => {
  if (!statusId) return null;
  return state.statusCatalog.find(status => status.id === statusId) || null;
};

/**
 * リスナーに対して現在有効なステータスを優先度順で取得
 */
export const getActiveStatusEntries = listener => {
  if (!listener || !Array.isArray(listener.statusAssignments)) return [];
  const activeAssignments = listener.statusAssignments.filter(assignment => assignment && !assignment.deactivatedAt);
  const entries = activeAssignments.map(assignment => ({
    assignment,
    definition: getStatusDefinitionById(assignment.statusId)
  }));
  const getPriority = entry => (entry.definition ? entry.definition.displayPriority || 0 : Number.NEGATIVE_INFINITY);
  entries.sort((a, b) => {
    const priorityDiff = getPriority(b) - getPriority(a);
    if (priorityDiff !== 0) return priorityDiff;
    const aDate = parseIsoDateTime(a.assignment.activatedAt);
    const bDate = parseIsoDateTime(b.assignment.activatedAt);
    const aTime = aDate ? aDate.getTime() : 0;
    const bTime = bDate ? bDate.getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    const aLabel = a.definition ? (a.definition.displayName || a.definition.id || "") : (a.assignment.statusId || "");
    const bLabel = b.definition ? (b.definition.displayName || b.definition.id || "") : (b.assignment.statusId || "");
    return nameCollator.compare(aLabel, bLabel);
  });
  return entries;
};

/**
 * 指定リスナーの有効なステータス付与を検索
 */
export const findActiveStatusAssignment = (listener, statusId) => {
  if (!listener || !Array.isArray(listener.statusAssignments)) return null;
  for (let index = listener.statusAssignments.length - 1; index >= 0; index -= 1) {
    const assignment = listener.statusAssignments[index];
    if (!assignment || assignment.statusId !== statusId) continue;
    if (!assignment.deactivatedAt) return assignment;
  }
  return null;
};

// --- バッジ要素生成 ---

/**
 * ステータス未設定時のバッジ（灰色）を生成
 */
export const createEmptyStatusBadge = (label, { size } = {}) => {
  const badge = document.createElement("span");
  badge.className = "status-badge status-badge--empty";
  if (size === "compact") badge.classList.add("status-badge--compact");
  badge.textContent = label || "ステータス未設定";
  return badge;
};

/**
 * ステータスの表示用バッジを生成
 */
export const createStatusBadgeElement = (entry, { size } = {}) => {
  const badge = document.createElement("span");
  badge.className = "status-badge";
  if (size === "compact") badge.classList.add("status-badge--compact");
  const { definition, assignment } = entry;
  const labelText = definition && (definition.displayName || definition.id)
    ? (definition.displayName || definition.id)
    : (assignment.statusId || "未定義ステータス");
  if (!definition) badge.classList.add("status-badge--unknown");
  const labelSpan = document.createElement("span");
  labelSpan.className = "status-badge-label";
  labelSpan.textContent = labelText;
  badge.appendChild(labelSpan);
  const tooltipLines = [];
  if (definition && definition.displayName) tooltipLines.push(definition.displayName);
  if (definition && definition.description) tooltipLines.push(definition.description);
  if (assignment.activatedAt) tooltipLines.push(`付与: ${assignment.activatedAt}`);
  if (assignment.deactivatedAt) tooltipLines.push(`解除: ${assignment.deactivatedAt}`);
  if (assignment.reason) tooltipLines.push(`理由: ${assignment.reason}`);
  if (tooltipLines.length) badge.title = tooltipLines.join("\n");
  badge.dataset.statusId = assignment.statusId;
  return badge;
};

/**
 * 指定した DOM 要素にステータスバッジを並べるユーティリティ
 */
export const populateStatusContainer = (element, entries, { showEmpty = false, emptyLabel = "ステータス未設定", size, limit } = {}) => {
  if (!element) return false;
  element.innerHTML = "";
  element.classList.add("status-badge-container");
  if (size === "compact") element.classList.add("status-badge-container--compact");
  else element.classList.remove("status-badge-container--compact");
  if (!Array.isArray(entries) || entries.length === 0) {
    if (showEmpty) {
      element.appendChild(createEmptyStatusBadge(emptyLabel, { size }));
      return true;
    }
    return false;
  }
  const renderEntries = Number.isFinite(limit) && limit > 0 ? entries.slice(0, limit) : entries;
  renderEntries.forEach(entry => {
    element.appendChild(createStatusBadgeElement(entry, { size }));
  });
  return element.childElementCount > 0;
};
