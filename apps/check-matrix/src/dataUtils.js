export const STORAGE_KEY = "checklist-boolean-data";

export const DEFAULT_DATA = Object.freeze({
  columns: [
    { id: "col-progress", name: "進捗", type: "boolean", order: 1 },
    { id: "col-review", name: "レビュー", type: "boolean", order: 2 },
    { id: "col-done", name: "完了", type: "boolean", order: 3 }
  ],
  tags: [
    { id: "tag-priority-high", label: "重要", order: 1, aliases: ["重要"] },
    { id: "tag-priority-normal", label: "通常", order: 2, aliases: ["通常"] },
    { id: "tag-priority-low", label: "低優先", order: 3, aliases: ["低優先"] }
  ],
  items: [
    {
      id: "item-alpha",
      name: "項目A",
      tag: "tag-priority-high",
      tags: ["tag-priority-high"],
      order: 1,
      values: { "col-progress": true, "col-review": false, "col-done": false }
    },
    {
      id: "item-bravo",
      name: "項目B",
      tag: "tag-priority-normal",
      tags: ["tag-priority-normal"],
      order: 2,
      values: { "col-progress": true, "col-review": true, "col-done": false }
    },
    {
      id: "item-charlie",
      name: "項目C",
      tag: "tag-priority-low",
      tags: ["tag-priority-low"],
      order: 3,
      values: { "col-progress": false, "col-review": false, "col-done": false }
    }
  ]
});

const BOOLEAN_TRUE_VALUES = new Set([true, "true", "1", 1]);
const TAG_ORDER_FALLBACK = Number.MAX_SAFE_INTEGER;
const TAG_ID_PREFIX = "tag-";

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeLabel(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function slugify(value, fallback) {
  const base = sanitizeLabel(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return base || fallback;
}

function normalizeOrder(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.trunc(number);
  return integer >= 1 ? integer : fallback;
}

function normalizeTag(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[a-z]+$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    return trimmed;
  }
  return null;
}

function compareTags(aTag, bTag) {
  const aHas = typeof aTag === "string" && aTag.trim().length > 0;
  const bHas = typeof bTag === "string" && bTag.trim().length > 0;
  if (aHas && bHas) {
    return aTag.trim().localeCompare(bTag.trim(), "ja", { sensitivity: "base" });
  }
  if (aHas) return -1;
  if (bHas) return 1;
  return 0;
}

function normalizeTagId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTagDefinitions(rawTags = []) {
  const definitions = [];
  const seenIds = new Set();

  ensureArray(rawTags).forEach((tag, index) => {
    const id = normalizeTagId(tag?.id);
    if (!id) {
      console.warn(`タグ定義のIDが空です (index: ${index})`);
      return;
    }
    if (seenIds.has(id)) {
      console.warn(`タグIDが重複しています: ${id}`);
      return;
    }
    const label = sanitizeLabel(tag?.label ?? "") || id;
    const order = normalizeOrder(tag?.order, TAG_ORDER_FALLBACK);
    const aliasSet = new Set();
    aliasSet.add(label);
    aliasSet.add(id);
    ensureArray(tag?.aliases)
      .map((alias) => sanitizeLabel(alias))
      .filter(Boolean)
      .forEach((alias) => aliasSet.add(alias));
    const aliases = Array.from(aliasSet);
    definitions.push({ id, label, order, aliases });
    seenIds.add(id);
  });

  definitions.sort((a, b) => {
    const orderDiff = (a.order ?? TAG_ORDER_FALLBACK) - (b.order ?? TAG_ORDER_FALLBACK);
    if (orderDiff !== 0) return orderDiff;
    return a.label.localeCompare(b.label, "ja", { sensitivity: "base" });
  });

  definitions.forEach((definition, index) => {
    definition.order = index + 1;
  });

  return definitions;
}

function createTagMatcher(tagDefinitions) {
  if (!Array.isArray(tagDefinitions) || tagDefinitions.length === 0) {
    return null;
  }

  const idMap = new Map();
  const aliasMap = new Map();

  const register = (value, definition) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!aliasMap.has(trimmed)) {
      aliasMap.set(trimmed, definition);
    }
    const normalized = normalizeTag(trimmed);
    if (normalized && !aliasMap.has(normalized)) {
      aliasMap.set(normalized, definition);
    }
  };

  tagDefinitions.forEach((definition) => {
    idMap.set(definition.id, definition);
    register(definition.id, definition);
    register(definition.label, definition);
    definition.aliases.forEach((alias) => register(alias, definition));
  });

  return (value) => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (idMap.has(trimmed)) {
      return idMap.get(trimmed);
    }
    const normalized = normalizeTag(trimmed);
    if (normalized && idMap.has(normalized)) {
      return idMap.get(normalized);
    }
    if (aliasMap.has(trimmed)) {
      return aliasMap.get(trimmed);
    }
    if (normalized && aliasMap.has(normalized)) {
      return aliasMap.get(normalized);
    }
    return null;
  };
}

function uniqueId(existingIds, base) {
  let id = base;
  let counter = 2;
  while (existingIds.has(id)) {
    id = `${base}-${counter++}`;
  }
  existingIds.add(id);
  return id;
}

function generateTagId(label, existingIds) {
  const baseSlug = slugify(label, "tag");
  const normalizedBase = baseSlug.startsWith(TAG_ID_PREFIX) ? baseSlug : `${TAG_ID_PREFIX}${baseSlug}`;
  return uniqueId(existingIds, normalizedBase);
}

function reassignTagOrders(tags) {
  tags.forEach((tag, index) => {
    tag.order = index + 1;
  });
  return tags;
}

function hasDuplicateTagLabel(tags, label, excludeId = null) {
  return tags.some((tag) => tag.label === label && tag.id !== excludeId);
}

function normalizeColumns(rawColumns) {
  const columns = [];
  const ids = new Set();
  ensureArray(rawColumns).forEach((column, index) => {
  const name = sanitizeLabel(column?.name ?? "");
    if (!name) {
      return;
    }
    const providedId = typeof column?.id === "string" ? column.id.trim() : "";
    const baseId = slugify(providedId || name, `column-${index + 1}`);
    const id = uniqueId(ids, baseId);
    const order = normalizeOrder(column?.order, index + 1);
    columns.push({ id, name, order, type: "boolean" });
  });
  columns.sort((a, b) => {
    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name, "ja");
  });
  columns.forEach((column, index) => {
    column.order = index + 1;
  });
  return columns;
}

function normalizeItems(rawItems, columns, tagDefinitions = []) {
  const columnIds = columns.map((column) => column.id);
  const seenIds = new Set();
  const items = [];
  const hasTagDefinitions = Array.isArray(tagDefinitions) && tagDefinitions.length > 0;
  const tagMatcher = createTagMatcher(tagDefinitions);
  const tagDefinitionMap = hasTagDefinitions
    ? new Map(tagDefinitions.map((definition) => [definition.id, definition]))
    : null;
  const unmatchedTagMessages = new Set();

  ensureArray(rawItems).forEach((item, index) => {
    const name = sanitizeLabel(item?.name ?? "");
    if (!name) {
      return;
    }
    const providedId = typeof item?.id === "string" ? item.id.trim() : "";
    const baseId = slugify(providedId || name, `item-${index + 1}`);
    const id = uniqueId(seenIds, baseId);

    const tagCandidates = [];
    if (typeof item?.tag === "string") {
      tagCandidates.push(item.tag);
    }
    ensureArray(item?.tags).forEach((tag) => {
      if (typeof tag === "string") {
        tagCandidates.push(tag);
      }
    });

    const cleanedTagCandidates = tagCandidates.map((tag) => sanitizeLabel(tag)).filter(Boolean);
    let primaryTag = null;
    let tags = [];

    if (hasTagDefinitions && tagMatcher) {
      const matchedIds = [];
      cleanedTagCandidates.forEach((candidate) => {
        const definition = tagMatcher(candidate);
        if (definition) {
          if (!matchedIds.includes(definition.id)) {
            matchedIds.push(definition.id);
          }
        } else {
          const warningKey = candidate.toLowerCase();
          if (!unmatchedTagMessages.has(warningKey)) {
            console.warn(`タグ "${candidate}" に対応する定義が見つかりません。`);
            unmatchedTagMessages.add(warningKey);
          }
        }
      });
      primaryTag = matchedIds[0] ?? null;
      tags = matchedIds;
    } else {
      const normalizedCandidates = [];
      cleanedTagCandidates.forEach((candidate) => {
        const normalized = normalizeTag(candidate);
        if (normalized && !normalizedCandidates.includes(normalized)) {
          normalizedCandidates.push(normalized);
        }
      });
      primaryTag = normalizedCandidates[0] ?? null;
      tags = normalizedCandidates;
    }

    const order = normalizeOrder(item?.order, index + 1);
    const valuesInput = item?.values && typeof item.values === "object" ? item.values : {};
    const values = {};
    columnIds.forEach((columnId) => {
      const raw = valuesInput[columnId];
      values[columnId] = BOOLEAN_TRUE_VALUES.has(raw);
    });

    items.push({
      id,
      name,
      order,
      tag: primaryTag ?? null,
      tags,
      values,
      __inputIndex: index
    });
  });

  const tagCounters = new Map();
  items.forEach((item) => {
    const tagKey = item.tag ?? "__UNTAGGED__";
    const current = tagCounters.get(tagKey) ?? 0;
    if (Number.isFinite(item.order)) {
      tagCounters.set(tagKey, Math.max(current, item.order));
    } else {
      const next = current + 1;
      tagCounters.set(tagKey, next);
      item.order = next;
    }
  });

  const tagOrderMap = hasTagDefinitions
    ? new Map(tagDefinitions.map((definition) => [definition.id, definition.order]))
    : null;

  items.sort((a, b) => {
    const aHasTag = typeof a.tag === "string" && a.tag.trim().length > 0;
    const bHasTag = typeof b.tag === "string" && b.tag.trim().length > 0;

    if (tagOrderMap) {
      const aOrder = tagOrderMap.get(a.tag ?? "") ?? TAG_ORDER_FALLBACK;
      const bOrder = tagOrderMap.get(b.tag ?? "") ?? TAG_ORDER_FALLBACK;
      const tagOrderDiff = aOrder - bOrder;
      if (tagOrderDiff !== 0) return tagOrderDiff;
      const aLabel = aHasTag ? tagDefinitionMap?.get(a.tag)?.label ?? a.tag : "";
      const bLabel = bHasTag ? tagDefinitionMap?.get(b.tag)?.label ?? b.tag : "";
      const labelDiff = aLabel.localeCompare(bLabel, "ja", { sensitivity: "base" });
      if (labelDiff !== 0) return labelDiff;
    } else {
      if (aHasTag !== bHasTag) {
        return aHasTag ? -1 : 1;
      }
    }

    const orderDiff = (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY);
    if (orderDiff !== 0) return orderDiff;

    if (!tagOrderMap) {
      const tagDiff = compareTags(a.tag, b.tag);
      if (tagDiff !== 0) return tagDiff;
    }

    const nameDiff = a.name.localeCompare(b.name, "ja", { sensitivity: "base" });
    if (nameDiff !== 0) return nameDiff;
    return (a.__inputIndex ?? 0) - (b.__inputIndex ?? 0);
  });

  return items.map(({ __inputIndex: _ignored, ...item }) => item);
}

export function normalizeData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("データ形式が不正です");
  }
  const columns = normalizeColumns(data.columns);
  if (columns.length === 0) {
    throw new Error("列情報が存在しません");
  }
  const tags = normalizeTagDefinitions(data.tags);
  const items = normalizeItems(data.items, columns, tags);
  return { columns, items, tags };
}

export function getVisibleColumns(allColumns, selectedColumnIds) {
  const columns = ensureArray(allColumns).slice().sort((a, b) => a.order - b.order);
  if (!Array.isArray(selectedColumnIds)) {
    return columns;
  }
  if (selectedColumnIds.length === 0) {
    return [];
  }
  const selectedSet = new Set(selectedColumnIds);
  return columns.filter((column) => selectedSet.has(column.id));
}

export function buildMatrix(data, options = {}) {
  const {
    selectedColumnIds = null,
    selectedTags = null,
    selectedItemIds = null
  } = options;
  const normalized = normalizeData(data);
  const columns = getVisibleColumns(normalized.columns, selectedColumnIds);
  const tagSet = Array.isArray(selectedTags) ? new Set(selectedTags) : null;
  const itemSet = Array.isArray(selectedItemIds) ? new Set(selectedItemIds) : null;
  const filteredItems = normalized.items.filter((item) => {
    if (tagSet) {
      const tagValue = item.tag ?? null;
      if (!tagSet.has(tagValue)) {
        return false;
      }
    }
    if (itemSet && !itemSet.has(item.id)) {
      return false;
    }
    return true;
  });
  const itemIndexMap = new Map();
  normalized.items.forEach((item, index) => {
    itemIndexMap.set(item.id, index);
  });
  const itemOrder = filteredItems.map((item) => itemIndexMap.get(item.id)).filter((index) => index !== undefined);
  const tagById = new Map(normalized.tags.map((tag) => [tag.id, tag]));
  return {
    columns,
    tags: normalized.tags,
    rows: filteredItems.map((item) => ({
      id: item.id,
      name: item.name,
      tag: item.tag ?? null,
      tagLabel: item.tag == null ? "" : tagById.get(item.tag)?.label ?? String(item.tag),
      values: columns.map((column) => Boolean(item.values?.[column.id]))
    })),
    itemOrder
  };
}

export function toJsonBlob(data) {
  const normalized = normalizeData(data);
  const json = JSON.stringify(normalized, null, 2);
  return new Blob([json], { type: "application/json" });
}

export function loadFromStorage(storage) {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return null;
  const stored = store.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return normalizeData(parsed);
  } catch (error) {
    console.warn("ローカルストレージのデータを読み込めません", error);
    return null;
  }
}

export function saveToStorage(data, storage) {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  } catch (error) {
    console.warn("ローカルストレージへの保存に失敗しました", error);
  }
}

export function clearStorage(storage) {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("ローカルストレージの削除に失敗しました", error);
  }
}

export function getDefaultData() {
  return normalizeData(cloneDeep(DEFAULT_DATA));
}

export function addColumn(data, columnName) {
  const normalized = normalizeData(data);
  const name = sanitizeLabel(columnName);
  if (!name) {
    throw new Error("列名を入力してください");
  }
  if (normalized.columns.some((column) => column.name === name)) {
    throw new Error("同名の列が既に存在します");
  }
  const existingIds = new Set(normalized.columns.map((column) => column.id));
  const id = uniqueId(existingIds, slugify(name, "column"));
  const order = (normalized.columns.at(-1)?.order ?? normalized.columns.length) + 1;
  const column = { id, name, order, type: "boolean" };
  const columns = [...normalized.columns, column];
  const items = normalized.items.map((item) => ({
    ...item,
    values: { ...item.values, [id]: false }
  }));
  return normalizeData({ columns, items, tags: normalized.tags });
}

export function renameColumn(data, columnId, nextName) {
  const normalized = normalizeData(data);
  const id = sanitizeLabel(columnId);
  const name = sanitizeLabel(nextName);
  if (!id) {
    throw new Error("列の指定が不正です");
  }
  if (!name) {
    throw new Error("新しい列名を入力してください");
  }
  const target = normalized.columns.find((column) => column.id === id);
  if (!target) {
    throw new Error("変更対象の列が見つかりません");
  }
  if (normalized.columns.some((column) => column.name === name && column.id !== id)) {
    throw new Error("同名の列が既に存在します");
  }
  const columns = normalized.columns.map((column) =>
    column.id === id ? { ...column, name } : column
  );
  return normalizeData({ columns, items: normalized.items, tags: normalized.tags });
}

export function removeColumn(data, columnId) {
  const normalized = normalizeData(data);
  const id = sanitizeLabel(columnId);
  if (!id) {
    throw new Error("削除対象の列が不正です");
  }
  const target = normalized.columns.find((column) => column.id === id);
  if (!target) {
    throw new Error("削除対象の列が見つかりません");
  }
  if (normalized.columns.length <= 1) {
    throw new Error("少なくとも1つの列を保持する必要があります");
  }
  const columns = normalized.columns.filter((column) => column.id !== id);
  const items = normalized.items.map((item) => {
    const { [id]: _removed, ...rest } = item.values;
    return { ...item, values: rest };
  });
  return normalizeData({ columns, items, tags: normalized.tags });
}

export function addItem(data, input) {
  const normalized = normalizeData(data);
  const name = sanitizeLabel(input?.name ?? "");
  if (!name) {
    throw new Error("項目名を入力してください");
  }
  if (normalized.items.some((item) => item.name === name)) {
    throw new Error("同名の項目が既に存在します");
  }
  const tags = ensureArray(input?.tags)
    .map((tag) => sanitizeLabel(tag))
    .filter(Boolean);
  const primaryTag = normalizeTag(input?.tag ?? tags[0] ?? null);
  const allTags = primaryTag ? [primaryTag, ...tags.filter((tag) => tag !== primaryTag)] : tags;
  const existingIds = new Set(normalized.items.map((item) => item.id));
  const id = uniqueId(existingIds, slugify(name, "item"));
  const order = normalizeOrder(input?.order, normalized.items.length + 1);
  const valuesInput = input?.values && typeof input.values === "object" ? input.values : {};
  const selectedColumns = new Set(ensureArray(input?.columns));
  const values = {};
  normalized.columns.forEach((column) => {
    if (column.id in valuesInput) {
      values[column.id] = BOOLEAN_TRUE_VALUES.has(valuesInput[column.id]);
    } else {
      values[column.id] = selectedColumns.has(column.id);
    }
  });
  const item = {
    id,
    name,
    order,
    tag: primaryTag ?? null,
    tags: allTags,
    values
  };
  return normalizeData({ columns: normalized.columns, items: [...normalized.items, item], tags: normalized.tags });
}

export function updateItem(data, itemId, updates) {
  const normalized = normalizeData(data);
  const id = sanitizeLabel(itemId);
  const targetIndex = normalized.items.findIndex((item) => item.id === id);
  if (targetIndex === -1) {
    throw new Error("更新対象の項目が見つかりません");
  }
  const existing = normalized.items[targetIndex];
  const name = sanitizeLabel(updates?.name ?? existing.name);
  if (!name) {
    throw new Error("項目名を入力してください");
  }
  if (normalized.items.some((item, index) => item.name === name && index !== targetIndex)) {
    throw new Error("同名の項目が既に存在します");
  }
  const tagsInput = updates?.tags ?? existing.tags;
  const tags = ensureArray(tagsInput).map((tag) => sanitizeLabel(tag)).filter(Boolean);
  const primaryTag = normalizeTag(updates?.tag ?? tags[0] ?? existing.tag ?? null);
  const allTags = primaryTag ? [primaryTag, ...tags.filter((tag) => tag !== primaryTag)] : tags;
  let values = { ...existing.values };
  if (updates?.values && typeof updates.values === "object") {
    normalized.columns.forEach((column) => {
      if (column.id in updates.values) {
        values[column.id] = BOOLEAN_TRUE_VALUES.has(updates.values[column.id]);
      }
    });
  }
  if (updates?.columns) {
    const selected = new Set(ensureArray(updates.columns));
    normalized.columns.forEach((column) => {
      values[column.id] = selected.has(column.id);
    });
  }
  const order = normalizeOrder(updates?.order, existing.order);
  const nextItem = {
    ...existing,
    name,
    tag: primaryTag ?? null,
    tags: allTags,
    order,
    values
  };
  const items = normalized.items.map((item, index) => (index === targetIndex ? nextItem : item));
  return normalizeData({ columns: normalized.columns, items, tags: normalized.tags });
}

export function removeItem(data, itemId) {
  const normalized = normalizeData(data);
  const id = sanitizeLabel(itemId);
  if (!id) {
    throw new Error("削除対象の項目が不正です");
  }
  if (!normalized.items.some((item) => item.id === id)) {
    throw new Error("削除対象の項目が見つかりません");
  }
  const items = normalized.items.filter((item) => item.id !== id);
  return normalizeData({ columns: normalized.columns, items, tags: normalized.tags });
}

export function addTag(data, label) {
  const normalized = normalizeData(data);
  const name = sanitizeLabel(label);
  if (!name) {
    throw new Error("タグ名を入力してください");
  }
  if (hasDuplicateTagLabel(normalized.tags, name)) {
    throw new Error("同名のタグが既に存在します");
  }
  const existingIds = new Set(normalized.tags.map((tag) => tag.id));
  const id = generateTagId(name, existingIds);
  const tag = {
    id,
    label: name,
    order: normalized.tags.length + 1,
    aliases: [name]
  };
  const tags = [...normalized.tags, tag];
  return normalizeData({ columns: normalized.columns, items: normalized.items, tags });
}

export function updateTag(data, tagId, nextLabel) {
  const normalized = normalizeData(data);
  const id = normalizeTagId(tagId);
  if (!id) {
    throw new Error("タグの指定が不正です");
  }
  const label = sanitizeLabel(nextLabel);
  if (!label) {
    throw new Error("タグ名を入力してください");
  }
  const index = normalized.tags.findIndex((tag) => tag.id === id);
  if (index === -1) {
    throw new Error("変更対象のタグが見つかりません");
  }
  if (hasDuplicateTagLabel(normalized.tags, label, id)) {
    throw new Error("同名のタグが既に存在します");
  }
  const target = normalized.tags[index];
  const aliasSet = new Set(target.aliases ?? []);
  aliasSet.add(label);
  const tags = normalized.tags.map((tag, currentIndex) =>
    currentIndex === index ? { ...tag, label, aliases: Array.from(aliasSet) } : tag
  );
  return normalizeData({ columns: normalized.columns, items: normalized.items, tags });
}

export function deleteTag(data, tagId) {
  const normalized = normalizeData(data);
  const id = normalizeTagId(tagId);
  if (!id) {
    throw new Error("削除対象のタグが不正です");
  }
  if (!normalized.tags.some((tag) => tag.id === id)) {
    throw new Error("削除対象のタグが見つかりません");
  }
  const tags = normalized.tags.filter((tag) => tag.id !== id);
  reassignTagOrders(tags);
  const items = normalized.items.map((item) => {
    const filteredTags = ensureArray(item.tags).filter((tag) => tag !== id);
    const primaryTag = item.tag === id ? filteredTags[0] ?? null : item.tag;
    return {
      ...item,
      tag: primaryTag ?? null,
      tags: filteredTags
    };
  });
  return normalizeData({ columns: normalized.columns, items, tags });
}

export function reorderTags(data, fromIndex, toIndex) {
  const normalized = normalizeData(data);
  const tags = [...normalized.tags];
  const length = tags.length;
  const from = Number(fromIndex);
  let target = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(target)) {
    throw new Error("並び替えの指定が不正です");
  }
  if (from < 0 || from >= length) {
    throw new Error("移動元のインデックスが範囲外です");
  }
  if (target < 0) {
    target = 0;
  }
  if (target >= length) {
    target = length - 1;
  }
  if (from === target) {
    return normalized;
  }
  const [moved] = tags.splice(from, 1);
  tags.splice(target, 0, moved);
  reassignTagOrders(tags);
  return normalizeData({ columns: normalized.columns, items: normalized.items, tags });
}
