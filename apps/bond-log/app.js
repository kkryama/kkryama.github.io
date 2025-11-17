const DB_NAME = "BondLogDB";
const STORE_NAME = "profiles";
const CURRENT_SCHEMA_VERSION = 2;

let db,
  schemaVersion = CURRENT_SCHEMA_VERSION,
  profiles = [],
  listeners = [],
  statusCatalog = [],
  giftTemplates = [],
  currentProfile = null,
  currentStream = null,
  currentListener = null,
  listenerSortMode = "name-asc";
const nameCollator = new Intl.Collator("ja", { sensitivity: "base" });
const PLATFORM_CANDIDATES = [
  "YouTube",
  "Twitch",
  "IRIAM",
  "Palmu",
  "SHOWROOM",
  "REALITY",
  "TikTok LIVE",
  "17LIVE",
  "Mildom",
  "OPENREC",
  "ツイキャス",
  "ニコニコ生放送"
];

// リスナーごとに保持する URL の最大数
const MAX_LISTENER_URLS = 5;

const generateId = prefix => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const sanitizeDateInput = raw => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const sanitizeTimeInput = raw => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const match = trimmed.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : "";
};

const formatDateInputValue = date => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatTimeInputValue = date => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const buildIsoDateTime = (dateValue, timeValue) => {
  const sanitizedDate = sanitizeDateInput(dateValue);
  const sanitizedTime = sanitizeTimeInput(timeValue);
  if (!sanitizedDate) return new Date().toISOString();
  const [year, month, day] = sanitizedDate.split("-").map(part => Number.parseInt(part, 10));
  const [hours, minutes] = sanitizedTime
    ? sanitizedTime.split(":").map(part => Number.parseInt(part, 10))
    : [0, 0];
  const localDate = new Date(year, (month || 1) - 1, day || 1, Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return Number.isNaN(localDate.getTime()) ? new Date().toISOString() : localDate.toISOString();
};

const formatDateTimeLocalValue = isoValue => {
  const parsed = parseIsoDateTime(isoValue);
  if (!parsed) return "";
  const datePart = formatDateInputValue(parsed);
  const timePart = formatTimeInputValue(parsed);
  return datePart && timePart ? `${datePart}T${timePart}` : "";
};

const buildIsoFromDateTimeLocal = localValue => {
  if (typeof localValue !== "string") return null;
  const trimmed = localValue.trim();
  if (!trimmed) return null;
  const [datePart, timePart] = trimmed.split("T");
  return buildIsoDateTime(datePart, timePart || "00:00");
};

const sanitizeUrlInput = raw => {
  if (!raw) return "";
  return String(raw).trim().slice(0, 2048);
};

const isValidIsoDateTime = value => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? false : true;
};

const normalizeIsoDateTime = value => {
  if (!isValidIsoDateTime(typeof value === "string" ? value : String(value || ""))) return null;
  return String(value).trim();
};

const parseIsoDateTime = value => {
  if (!isValidIsoDateTime(typeof value === "string" ? value : String(value || ""))) return null;
  return new Date(value);
};

// ISO 8601 文字列を日本語表示用の日時へ整形する
const formatDateTimeForDisplay = value => {
  if (!value) return "未記録";
  const parsed = parseIsoDateTime(value);
  if (!parsed) return "未記録";
  return parsed.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const formatStreamSchedule = stream => {
  if (!stream) return "";
  const datePart = stream.date || "";
  const timePart = stream.startTime || "";
  if (datePart && timePart) return `${datePart} ${timePart}`;
  if (datePart) return datePart;
  return "日時未設定";
};

const updateStreamUrlLink = stream => {
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

const createDefaultGiftTemplates = () => [
  // {
  //   id: generateId("gt"),
  //   name: "スーパーチャット（¥1,000）",
  //   item: "スーパーチャット",
  //   amount: "1000"
  // },
  // {
  //   id: generateId("gt"),
  //   name: "スーパーチャット（¥5,000）",
  //   item: "スーパーチャット",
  //   amount: "5000"
  // },
  // {
  //   id: generateId("gt"),
  //   name: "ギフト（100コイン）",
  //   item: "100コイン",
  //   amount: "100"
  // }
];

const createDefaultData = () => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  profiles: [],
  listeners: [],
  statusCatalog: [],
  giftTemplates: createDefaultGiftTemplates()
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = e => reject(e);
  });
}

function saveAppData() {
  const tx = db.transaction(STORE_NAME, "readwrite");
  schemaVersion = CURRENT_SCHEMA_VERSION;
  const payload = {
    schemaVersion,
    profiles,
    listeners,
    statusCatalog,
    giftTemplates
  };
  tx.objectStore(STORE_NAME).put({ id: "main", data: payload });
}

async function loadAppData() {
  const tx = db.transaction(STORE_NAME, "readonly");
  const req = tx.objectStore(STORE_NAME).get("main");
  return new Promise(res => {
    req.onsuccess = () => {
      const payload = req.result ? req.result.data : null;
      res(normalizeData(payload));
    };
    req.onerror = () => res(createDefaultData());
  });
}

const getListenerById = listenerId => listeners.find(listener => listener.id === listenerId) || null;

const getProfileListeners = profileId => listeners.filter(listener => Array.isArray(listener.profileIds) && listener.profileIds.includes(profileId));

const linkListenerToProfile = (listener, profileId) => {
  if (!listener) return;
  if (!Array.isArray(listener.profileIds)) listener.profileIds = [];
  if (!listener.profileIds.includes(profileId)) listener.profileIds.push(profileId);
};

const formatProfileLabel = profile => `[${profile.platform}] ${profile.accountName}`;

const parseTagsInput = raw => (raw || "")
  .split(",")
  .map(tag => tag.trim())
  .filter(tag => tag)
  .slice(0, 10);

// 入力値を正規化し、重複を排除した URL 配列を返す
const normalizeListenerUrls = raw => {
  if (!raw) return [];
  const source = Array.isArray(raw) ? raw : String(raw).split(/\r?\n|,/);
  const unique = [];
  source.forEach(entry => {
    const sanitized = sanitizeUrlInput(entry);
    if (!sanitized) return;
    if (unique.includes(sanitized)) return;
    unique.push(sanitized);
  });
  return unique.slice(0, MAX_LISTENER_URLS);
};

const sanitizeStream = stream => {
  if (!stream || typeof stream !== "object") {
    return { id: generateId("s"), title: "", date: "", startTime: "", url: "", attendees: [], gifts: [] };
  }
  const id = stream.id || generateId("s");
  const inferredDate = sanitizeDateInput(stream.date || stream.startDate || (stream.scheduledAt ? stream.scheduledAt.split("T")[0] : ""));
  const inferredTime = sanitizeTimeInput(stream.startTime || (stream.scheduledAt ? stream.scheduledAt.split("T")[1] : ""));
  const attendees = Array.isArray(stream.attendees) ? [...stream.attendees] : [];
  const gifts = Array.isArray(stream.gifts)
    ? stream.gifts.map(gift => {
        if (!gift || typeof gift !== "object") return { listenerId: "", item: "", amount: "" };
        return {
          listenerId: gift.listenerId || "",
          item: gift.item || "",
          amount: gift.amount || ""
        };
      })
    : [];
  return {
    id,
    title: (stream.title || "").trim(),
    date: inferredDate,
    startTime: inferredTime,
    url: sanitizeUrlInput(stream.url),
    attendees,
    gifts
  };
};

const sanitizeProfile = profile => {
  if (!profile || typeof profile !== "object") return { id: generateId("p"), platform: "", accountName: "", streams: [] };
  const id = profile.id || generateId("p");
  const normalizedUrl = (profile.url || "").trim().slice(0, 2048);
  const normalizedNote = (profile.note || "").trim().slice(0, 1000);
  return {
    id,
    platform: (profile.platform || "").trim(),
    accountName: (profile.accountName || "").trim(),
    url: normalizedUrl,
    note: normalizedNote,
    streams: Array.isArray(profile.streams) ? profile.streams.map(sanitizeStream) : []
  };
};

const sanitizeListener = listener => {
  if (!listener || typeof listener !== "object") return { id: generateId("l"), name: "", tags: [], memo: "", profileIds: [], urls: [], statusAssignments: [] };
  const id = listener.id || generateId("l");
  const tags = Array.isArray(listener.tags)
    ? listener.tags
        .filter(tag => typeof tag === "string")
        .map(tag => tag.trim())
        .filter(tag => tag)
        .slice(0, 10)
    : [];
  const profileIds = Array.isArray(listener.profileIds)
    ? listener.profileIds.filter(pid => typeof pid === "string")
    : [];
  const name = typeof listener.name === "string" ? listener.name.trim() : "";
  const memo = typeof listener.memo === "string" ? listener.memo.slice(0, 1000) : "";
  const statusAssignments = Array.isArray(listener.statusAssignments)
    ? listener.statusAssignments
        .map(sanitizeStatusAssignment)
        .filter(Boolean)
    : [];
  return {
    id,
    name,
    tags,
    memo,
    profileIds,
    urls: normalizeListenerUrls(listener.urls),
    statusAssignments
  };
};

const sanitizeGiftTemplate = template => {
  if (!template || typeof template !== "object") return null;
  const id = template.id || generateId("gt");
  const rawItem = typeof template.item === "string" ? template.item.trim() : "";
  const rawName = typeof template.name === "string" ? template.name.trim() : "";
  const rawAmount = typeof template.amount === "string" ? template.amount.trim() : template.amount === undefined ? "" : String(template.amount);
  const name = rawName || rawItem;
  if (!name && !rawItem) return null;
  return {
    id,
    name: name || "テンプレート",
    item: rawItem,
    amount: rawAmount
  };
};

const sanitizeStatusDefinition = definition => {
  if (!definition || typeof definition !== "object") return null;
  const id = typeof definition.id === "string" && definition.id.trim() ? definition.id.trim() : generateId("status_");
  const displayName = typeof definition.displayName === "string" ? definition.displayName.trim() : "";
  const description = typeof definition.description === "string" ? definition.description.trim() : "";
  const priorityValue = Number.parseInt(definition.displayPriority, 10);
  const displayPriority = Number.isFinite(priorityValue) ? priorityValue : 0;
  const isArchived = Boolean(definition.isArchived);
  return {
    id,
    displayName,
    description,
    displayPriority,
    isArchived
  };
};

const sanitizeStatusAssignment = assignment => {
  if (!assignment || typeof assignment !== "object") return null;
  const statusId = typeof assignment.statusId === "string" ? assignment.statusId.trim() : "";
  if (!statusId) return null;
  const source = assignment.source === "system" ? "system" : "manual";
  const activatedAt = normalizeIsoDateTime(assignment.activatedAt);
  const deactivatedAt = normalizeIsoDateTime(assignment.deactivatedAt);
  const reason = typeof assignment.reason === "string" ? assignment.reason.trim() : "";
  const note = typeof assignment.note === "string" ? assignment.note.trim() : "";
  return {
    statusId,
    source,
    activatedAt,
    deactivatedAt,
    reason,
    note
  };
};

const convertLegacyProfiles = legacyProfiles => {
  const migratedProfiles = [];
  const migratedListeners = [];
  (Array.isArray(legacyProfiles) ? legacyProfiles : []).forEach(rawProfile => {
    const sanitizedProfile = sanitizeProfile(rawProfile);
    const profileId = sanitizedProfile.id;
    const legacyListeners = Array.isArray(rawProfile && rawProfile.listeners) ? rawProfile.listeners : [];
    const idMap = new Map();
    legacyListeners.forEach(rawListener => {
      if (!rawListener || typeof rawListener !== "object") return;
      const proposedKey = rawListener.id || generateId("l");
      const finalId = idMap.has(proposedKey) ? generateId("l") : proposedKey;
      idMap.set(rawListener.id || finalId, finalId);
      const sanitizedListener = sanitizeListener({ ...rawListener, id: finalId, profileIds: [profileId] });
      sanitizedListener.profileIds = [profileId];
      migratedListeners.push(sanitizedListener);
    });
    sanitizedProfile.streams = sanitizedProfile.streams.map(stream => {
      const attendees = Array.isArray(stream.attendees) ? stream.attendees.map(id => idMap.get(id) || id) : [];
      const gifts = Array.isArray(stream.gifts)
        ? stream.gifts.map(gift => {
            if (!gift || typeof gift !== "object") return gift;
            const mappedId = gift.listenerId ? (idMap.get(gift.listenerId) || gift.listenerId) : gift.listenerId;
            return { ...gift, listenerId: mappedId };
          })
        : [];
      return { ...stream, attendees, gifts };
    });
    migratedProfiles.push(sanitizedProfile);
  });
  return {
    schemaVersion: 1,
    profiles: migratedProfiles,
    listeners: migratedListeners.map(listener => ({ ...listener, statusAssignments: listener.statusAssignments || [] })),
    statusCatalog: [],
    giftTemplates: createDefaultGiftTemplates()
  };
};

const normalizeData = raw => {
  if (!raw) return createDefaultData();
  if (Array.isArray(raw)) return convertLegacyProfiles(raw);
  const hasProfiles = Array.isArray(raw.profiles);
  const hasListeners = Array.isArray(raw.listeners);
  if (!hasProfiles) return createDefaultData();
  if (!hasListeners) return convertLegacyProfiles(raw.profiles);
  const sanitizedTemplates = Array.isArray(raw.giftTemplates)
    ? raw.giftTemplates
        .map(sanitizeGiftTemplate)
        .filter(Boolean)
    : createDefaultGiftTemplates();
  const sanitizedStatusesRaw = Array.isArray(raw.statusCatalog)
    ? raw.statusCatalog
        .map(sanitizeStatusDefinition)
        .filter(Boolean)
    : [];
  const statusMap = new Map();
  sanitizedStatusesRaw.forEach(status => {
    if (statusMap.has(status.id)) return;
    statusMap.set(status.id, status);
  });
  const sanitizedStatusCatalog = Array.from(statusMap.values());
  return {
    schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : (statusMap.size > 0 ? CURRENT_SCHEMA_VERSION : 1),
    profiles: raw.profiles.map(sanitizeProfile),
    listeners: raw.listeners.map(sanitizeListener),
    giftTemplates: sanitizedTemplates,
    statusCatalog: sanitizedStatusCatalog
  };
};

// ステータスIDから定義を取得する（未定義の場合は null）
const getStatusDefinitionById = statusId => {
  if (!statusId) return null;
  return statusCatalog.find(status => status.id === statusId) || null;
};

// リスナーに対して現在有効なステータスを優先度順で取得
const getActiveStatusEntries = listener => {
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

const findActiveStatusAssignment = (listener, statusId) => {
  if (!listener || !Array.isArray(listener.statusAssignments)) return null;
  for (let index = listener.statusAssignments.length - 1; index >= 0; index -= 1) {
    const assignment = listener.statusAssignments[index];
    if (!assignment || assignment.statusId !== statusId) continue;
    if (!assignment.deactivatedAt) return assignment;
  }
  return null;
};

// ステータス未設定時のバッジ（灰色）を生成
const createEmptyStatusBadge = (label, { size } = {}) => {
  const badge = document.createElement("span");
  badge.className = "status-badge status-badge--empty";
  if (size === "compact") badge.classList.add("status-badge--compact");
  badge.textContent = label || "ステータス未設定";
  return badge;
};

// ステータスの表示用バッジを生成
const createStatusBadgeElement = (entry, { size } = {}) => {
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

// 指定した DOM 要素にステータスバッジを並べるユーティリティ
const populateStatusContainer = (element, entries, { showEmpty = false, emptyLabel = "ステータス未設定", size, limit } = {}) => {
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

// === ステータスカタログ管理 UI ===
const statusManagerState = {
  selectedId: null,
  stateFilter: "active",
  formDirty: false,
  editingMode: "none",
  draft: null
};
const statusManagerRefs = {};
let statusFormSyncing = false;

// ステータスIDを衝突しないよう自動採番するユーティリティ
const generateUniqueStatusId = () => {
  let candidate = "";
  do {
    candidate = generateId("status_");
  } while (
    statusCatalog.some(status => status && status.id === candidate) ||
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

const countStatusAssignments = statusId => {
  if (!statusId) return 0;
  let count = 0;
  listeners.forEach(listener => {
    if (!listener || !Array.isArray(listener.statusAssignments)) return;
    listener.statusAssignments.forEach(assignment => {
      if (assignment && assignment.statusId === statusId) count += 1;
    });
  });
  return count;
};

const hasUnsavedStatusChanges = () => statusManagerState.formDirty || statusManagerState.editingMode === "draft";

const confirmStatusDiscard = () => {
  if (!hasUnsavedStatusChanges()) return true;
  return confirm("未保存の変更があります。破棄しますか？");
};

const setStatusFormActive = isActive => {
  if (!statusManagerRefs.form || !statusManagerRefs.editorEmptyMessage) return;
  if (isActive) {
    statusManagerRefs.form.classList.add("active");
    statusManagerRefs.editorEmptyMessage.style.display = "none";
  } else {
    statusManagerRefs.form.classList.remove("active");
    statusManagerRefs.editorEmptyMessage.style.display = "block";
  }
};

const getEditingStatus = () => {
  if (statusManagerState.editingMode === "draft" && statusManagerState.draft) return statusManagerState.draft;
  if (statusManagerState.editingMode === "existing") {
    return statusCatalog.find(status => status.id === statusManagerState.selectedId) || null;
  }
  return null;
};

const updateStatusArchiveToggleLabel = () => {
  if (!statusManagerRefs.archiveToggle || !statusManagerRefs.isArchived) return;
  statusManagerRefs.archiveToggle.textContent = statusManagerRefs.isArchived.checked ? "アクティブに戻す" : "アーカイブへ移動";
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

const populateStatusForm = (status, { isDraft } = {}) => {
  if (!statusManagerRefs.form) return;
  statusFormSyncing = true;
  if (statusManagerRefs.id) statusManagerRefs.id.value = status.id || "";
  statusManagerRefs.displayName.value = status.displayName || "";
  statusManagerRefs.description.value = status.description || "";
  statusManagerRefs.displayPriority.value = Number.isFinite(status.displayPriority) ? status.displayPriority : 0;
  statusManagerRefs.isArchived.checked = Boolean(status.isArchived);
  updateStatusArchiveToggleLabel();
  updateStatusUsageInfo(status, { isDraft: Boolean(isDraft) });
  statusFormSyncing = false;
  statusManagerState.formDirty = false;
  setStatusFormActive(true);
  if (statusManagerRefs.deleteBtn) statusManagerRefs.deleteBtn.disabled = statusManagerState.editingMode !== "existing";
  if (statusManagerRefs.resetBtn) statusManagerRefs.resetBtn.disabled = false;
};

const syncDraftFromForm = () => {
  if (statusManagerState.editingMode !== "draft" || !statusManagerState.draft) return;
  if (statusManagerRefs.displayName) {
    statusManagerState.draft.displayName = statusManagerRefs.displayName.value.trim();
  }
  if (statusManagerRefs.displayPriority) {
    const parsed = Number.parseInt(statusManagerRefs.displayPriority.value, 10);
    statusManagerState.draft.displayPriority = Number.isFinite(parsed) ? parsed : 0;
  }
  if (statusManagerRefs.isArchived) {
    statusManagerState.draft.isArchived = statusManagerRefs.isArchived.checked;
  }
};

const renderStatusList = () => {
  if (!statusManagerRefs.list) return;
  const filtered = statusCatalog.filter(status => {
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
      statusManagerRefs.emptyMessage.textContent = statusCatalog.length
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
    if ((status.__draft && statusManagerState.editingMode === "draft") || (!status.__draft && status.id === statusManagerState.selectedId)) {
      li.classList.add("selected");
    }
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
        if (status.id === statusManagerState.selectedId && statusManagerState.editingMode === "existing") return;
        if (!confirmStatusDiscard()) return;
        const target = statusCatalog.find(entry => entry.id === status.id);
        if (!target) return;
        statusManagerState.selectedId = target.id;
        statusManagerState.editingMode = "existing";
        statusManagerState.draft = null;
        populateStatusForm(target, { isDraft: false });
        renderStatusList();
      };
    }
    statusManagerRefs.list.appendChild(li);
  });
};

const resetStatusManager = () => {
  statusManagerState.selectedId = null;
  statusManagerState.stateFilter = "active";
  statusManagerState.formDirty = false;
  statusManagerState.editingMode = "none";
  statusManagerState.draft = null;
  setStatusFormActive(false);
  if (statusManagerRefs.deleteBtn) statusManagerRefs.deleteBtn.disabled = true;
  if (statusManagerRefs.resetBtn) statusManagerRefs.resetBtn.disabled = true;
  if (statusManagerRefs.isArchived) statusManagerRefs.isArchived.checked = false;
  if (statusManagerRefs.usageInfo) statusManagerRefs.usageInfo.textContent = "";
  updateStatusArchiveToggleLabel();
};

const beginCreateStatus = () => {
  if (!confirmStatusDiscard()) return;
  statusManagerState.draft = createInitialStatusDraft();
  statusManagerState.selectedId = statusManagerState.draft.id;
  statusManagerState.editingMode = "draft";
  populateStatusForm(statusManagerState.draft, { isDraft: true });
  renderStatusList();
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
  return {
    id: resolvedId,
    displayName: displayNameRaw,
    description: statusManagerRefs.description.value.trim(),
    displayPriority: priorityValue,
    isArchived: Boolean(statusManagerRefs.isArchived.checked)
  };
};

const applyStatusFormSave = () => {
  const payload = collectStatusFormValues();
  if (!payload) return;
  if (statusManagerState.editingMode === "draft") {
    if (statusCatalog.some(status => status.id === payload.id)) {
      alert("同じステータスが既に存在します");
      return;
    }
    statusCatalog.push(payload);
    statusManagerState.selectedId = payload.id;
    statusManagerState.editingMode = "existing";
    statusManagerState.draft = null;
  } else if (statusManagerState.editingMode === "existing") {
    const originalId = statusManagerState.selectedId;
    if (payload.id !== originalId && statusCatalog.some(status => status.id === payload.id)) {
      alert("同じステータスが既に存在します");
      return;
    }
    const index = statusCatalog.findIndex(status => status.id === originalId);
    if (index >= 0) {
      statusCatalog[index] = payload;
    } else {
      statusCatalog.push(payload);
    }
    if (originalId && originalId !== payload.id) {
      listeners.forEach(listener => {
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
  saveAppData();
  populateStatusForm(payload, { isDraft: false });
  renderStatusList();
  refreshCurrentView();
  refreshListenerDetail();
  renderAttendees();
};

const discardStatusChanges = () => {
  if (statusManagerState.editingMode === "draft") {
    statusManagerState.draft = createInitialStatusDraft();
    statusManagerState.selectedId = statusManagerState.draft.id;
    populateStatusForm(statusManagerState.draft, { isDraft: true });
    renderStatusList();
    return;
  }
  if (statusManagerState.editingMode === "existing") {
    const status = statusCatalog.find(entry => entry.id === statusManagerState.selectedId);
    if (!status) {
      resetStatusManager();
      renderStatusList();
      return;
    }
    populateStatusForm(status, { isDraft: false });
    renderStatusList();
  }
};

const removeStatusDefinition = () => {
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
  const targetStatus = statusCatalog.find(entry => entry.id === targetId) || null;
  const statusLabel = targetStatus && targetStatus.displayName
    ? targetStatus.displayName
    : "該当ステータス";
  const usageCount = countStatusAssignments(targetId);
  const message = usageCount > 0
    ? `${statusLabel} を削除すると、付与履歴 ${usageCount} 件も同時に削除されます。よろしいですか？`
    : `${statusLabel} を削除しますか？`;
  if (!confirm(message)) return;
  statusCatalog = statusCatalog.filter(status => status.id !== targetId);
  listeners.forEach(listener => {
    if (!listener || !Array.isArray(listener.statusAssignments)) return;
    listener.statusAssignments = listener.statusAssignments.filter(assignment => assignment && assignment.statusId !== targetId);
  });
  statusManagerState.selectedId = null;
  statusManagerState.editingMode = "none";
  statusManagerState.formDirty = false;
  setStatusFormActive(false);
  renderStatusList();
  saveAppData();
  refreshCurrentView();
  refreshListenerDetail();
  renderAttendees();
};

const openStatusManagement = () => {
  resetStatusManager();
  if (statusManagerRefs.filterState) statusManagerRefs.filterState.value = statusManagerState.stateFilter;
  renderStatusList();
  showView("status-management-view");
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateTabState('status');
};

const closeStatusManagement = () => {
  resetStatusManager();
  renderStatusList();
};

const createActionButton = (label, extraClass, handler) => {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className = extraClass ? `list-action-btn ${extraClass}` : "list-action-btn";
  btn.onclick = e => {
    e.stopPropagation();
    handler(e);
  };
  return btn;
};

// リスナーごとの最終参加日時（Unix 時間ミリ秒）を算出
const buildLatestAttendanceMap = profile => {
  const map = new Map();
  if (!profile || !Array.isArray(profile.streams)) return map;
  profile.streams.forEach(stream => {
    if (!stream || !Array.isArray(stream.attendees)) return;
  const parsedDate = parseStreamDate(stream.date, stream.startTime);
    if (!parsedDate) return;
    const timestamp = parsedDate.getTime();
    stream.attendees.forEach(listenerId => {
      const prev = map.get(listenerId);
      if (prev === undefined || prev < timestamp) map.set(listenerId, timestamp);
    });
  });
  return map;
};

const buildLatestAttendanceMapAll = () => {
  const map = new Map();
  profiles.forEach(profile => {
    const eachMap = buildLatestAttendanceMap(profile);
    eachMap.forEach((timestamp, listenerId) => {
      const prev = map.get(listenerId);
      if (prev === undefined || prev < timestamp) map.set(listenerId, timestamp);
    });
  });
  return map;
};

// === 共通UI ===
const showView = id => {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
};

// 現在表示中のビューに応じて適切なレンダリング関数を呼び出す
const refreshCurrentView = () => {
  const activeView = document.querySelector(".view.active");
  if (!activeView) return;
  
  const viewId = activeView.id;
  switch(viewId) {
    case "dashboard-view":
      renderDashboard();
      break;
    case "platform-list-view":
      renderPlatformList();
      break;
    case "listener-list-view":
      renderListenerList();
      break;
    case "listener-detail-view":
      if (currentListener) {
        refreshListenerDetail();
      }
      break;
    // その他のビューは必要に応じて追加
  }
};

const renderDashboard = () => {
  // プラットフォームの簡易表示（最大3件）
  const dashboardProfileList = document.getElementById("dashboard-profile-list");
  const dashboardProfileEmpty = document.getElementById("dashboard-profile-empty");
  
  if (dashboardProfileList && dashboardProfileEmpty) {
    dashboardProfileList.innerHTML = "";
    const platformPreview = profiles.slice(0, 3);
    
    if (platformPreview.length === 0) {
      dashboardProfileEmpty.style.display = "block";
    } else {
      dashboardProfileEmpty.style.display = "none";
      platformPreview.forEach(profile => {
        const li = document.createElement("li");
        const header = document.createElement("div");
        header.className = "list-item-header";

        const title = document.createElement("span");
        title.className = "list-title";
        title.textContent = formatProfileLabel(profile);
        header.appendChild(title);

        li.appendChild(header);
        li.onclick = () => openProfile(profile.id);
        dashboardProfileList.appendChild(li);
      });
    }
  }
  
  // リスナーの簡易表示（最大5件、最終参加日時順）
  const dashboardListenerList = document.getElementById("dashboard-listener-list");
  const dashboardListenerEmpty = document.getElementById("dashboard-listener-empty");
  
  if (dashboardListenerList && dashboardListenerEmpty) {
    dashboardListenerList.innerHTML = "";
    const latestAttendanceMap = buildLatestAttendanceMapAll();
    
    const compareNameAsc = (a, b) => {
      const result = nameCollator.compare((a.name || "").trim(), (b.name || "").trim());
      if (result !== 0) return result;
      return (a.id || "").localeCompare(b.id || "");
    };
    
    const sorted = [...listeners];
    sorted.sort((a, b) => {
      const aTime = latestAttendanceMap.get(a.id);
      const bTime = latestAttendanceMap.get(b.id);
      const aValue = typeof aTime === "number" ? aTime : Number.NEGATIVE_INFINITY;
      const bValue = typeof bTime === "number" ? bTime : Number.NEGATIVE_INFINITY;
      if (aValue !== bValue) return bValue - aValue;
      return compareNameAsc(a, b);
    });
    
    const listenerPreview = sorted.slice(0, 5);
    
    if (listenerPreview.length === 0) {
      dashboardListenerEmpty.style.display = "block";
    } else {
      dashboardListenerEmpty.style.display = "none";
      listenerPreview.forEach(listener => {
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

        li.onclick = () => openListener(listener.id);
        dashboardListenerList.appendChild(li);
      });
    }
  }
};

const renderPlatformList = () => {
  const list = document.getElementById("platform-list");
  const emptyState = document.getElementById("platform-empty");
  
  if (!list || !emptyState) return;
  
  list.innerHTML = "";
  
  if (profiles.length === 0) {
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
  }
  
  profiles.forEach(profile => {
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
    if (currentProfile && currentProfile.id === profile.id) {
      currentProfile.platform = profile.platform;
      currentProfile.accountName = profile.accountName;
      currentProfile.url = profile.url;
      currentProfile.note = profile.note;
  document.getElementById("profile-title").textContent = formatProfileLabel(currentProfile);
  renderStreams();
    }
  });
};

const confirmDeleteProfile = profile => {
  if (!confirm(`${formatProfileLabel(profile)} を削除します。関連する配信・参加記録・ギフト履歴も削除されます。よろしいですか？`)) return;
  profiles = profiles.filter(p => p.id !== profile.id);
  listeners.forEach(listener => {
    if (!Array.isArray(listener.profileIds)) return;
    listener.profileIds = listener.profileIds.filter(pid => pid !== profile.id);
  });
  if (currentProfile && currentProfile.id === profile.id) {
    currentProfile = null;
    currentStream = null;
    showView("dashboard-view");
  }
  saveAppData();
  refreshCurrentView();
  refreshListenerDetail();
};

const openProfile = id => {
  currentProfile = profiles.find(p => p.id === id) || null;
  if (!currentProfile) return;
  document.getElementById("profile-title").textContent = formatProfileLabel(currentProfile);
  renderStreams();
  showView("profile-detail-view");
};

const renderStreams = () => {
  const list = document.getElementById("stream-list");
  list.innerHTML = "";
  if (!currentProfile) return;
  currentProfile.streams.forEach(stream => {
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
    if (currentStream && currentStream.id === stream.id) {
      currentStream.title = stream.title;
      currentStream.date = stream.date;
      currentStream.startTime = stream.startTime;
      currentStream.url = stream.url;
      document.getElementById("stream-title").textContent = currentStream.title || "無題の配信";
      document.getElementById("stream-schedule").textContent = formatStreamSchedule(currentStream);
      updateStreamUrlLink(currentStream);
    }
    refreshCurrentView();
    refreshListenerDetail();
  });
};

const confirmDeleteStream = stream => {
  if (!confirm(`${formatStreamSchedule(stream)} ${stream.title} を削除します。参加者とギフトの記録も失われます。よろしいですか？`)) return;
  if (!currentProfile) return;
  currentProfile.streams = currentProfile.streams.filter(s => s.id !== stream.id);
  if (currentStream && currentStream.id === stream.id) {
    currentStream = null;
    showView("profile-detail-view");
  }
  saveAppData();
  renderStreams();
  refreshCurrentView();
  refreshListenerDetail();
};

const renderListenerList = () => {
  const list = document.getElementById("listener-list");
  const emptyMessage = document.getElementById("listener-empty");
  if (!list || !emptyMessage) return;
  list.innerHTML = "";
  const latestAttendanceMap = buildLatestAttendanceMapAll();
  const sortSelect = document.getElementById("listener-sort");
  if (sortSelect) sortSelect.value = listenerSortMode;
  const compareNameAsc = (a, b) => {
    const result = nameCollator.compare((a.name || "").trim(), (b.name || "").trim());
    if (result !== 0) return result;
    return (a.id || "").localeCompare(b.id || "");
  };
  const sorted = [...listeners];
  sorted.sort((a, b) => {
    switch (listenerSortMode) {
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
          .map(pid => profiles.find(p => p.id === pid))
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

const openListener = id => {
  currentListener = getListenerById(id);
  if (!currentListener) return;
  document.getElementById("listener-name").textContent = currentListener.name;
  const membershipLabels = Array.isArray(currentListener.profileIds)
    ? currentListener.profileIds
        .map(pid => profiles.find(p => p.id === pid))
        .filter(p => Boolean(p))
        .map(formatProfileLabel)
    : [];
  document.getElementById("listener-profile").textContent = membershipLabels.length ? membershipLabels.join(" / ") : "紐付け済みプラットフォームなし";
  document.getElementById("listener-name-static").textContent = currentListener.name;
  document.getElementById("listener-memo").textContent = currentListener.memo ? currentListener.memo : "メモはまだ登録されていません";
  renderListenerUrls();
  renderListenerTags();
  renderListenerStatuses();
  renderListenerAttendances();
  renderListenerGifts();
  showView("listener-detail-view");
};

const renderListenerTags = () => {
  const container = document.getElementById("listener-tags");
  container.innerHTML = "";
  if (!currentListener.tags || currentListener.tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "タグは未設定です";
    container.appendChild(empty);
    return;
  }
  currentListener.tags.forEach(tag => {
    if (!tag) return;
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    container.appendChild(chip);
  });
};

const renderListenerStatuses = () => {
  if (!currentListener) return;
  const activeEntries = getActiveStatusEntries(currentListener);
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
    const title = document.createElement("div");
    title.className = "status-detail-title";
    title.textContent = labelText;
    item.appendChild(title);

    if (definition && definition.description) {
      const description = document.createElement("div");
      description.className = "status-detail-description";
      description.textContent = definition.description;
      item.appendChild(description);
    }

    const state = document.createElement("div");
    state.className = "status-detail-meta";
    state.textContent = "状態: 現在有効";
    item.appendChild(state);

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

const openListenerStatusManager = () => {
  if (!currentListener) {
    alert("リスナーを選択してから操作してください。");
    return;
  }
  if (!Array.isArray(currentListener.statusAssignments)) currentListener.statusAssignments = [];
  const activeIds = new Set();
  currentListener.statusAssignments.forEach(assignment => {
    if (!assignment || assignment.deactivatedAt) return;
    activeIds.add(assignment.statusId);
  });
  const statusItems = [];
  statusCatalog.forEach(status => {
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
      value: currentListener.name || "(名称未設定)"
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
      label: "付与日",
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
      currentListener.statusAssignments.push({
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
      const assignment = findActiveStatusAssignment(currentListener, statusId);
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

const openListenerStatusHistory = () => {
  if (!currentListener) {
    alert("リスナーを選択してから操作してください。");
    return;
  }

  let showActiveOnly = false;
  const collectEntries = () => {
    const assignments = Array.isArray(currentListener.statusAssignments)
      ? currentListener.statusAssignments.filter(entry => entry && entry.statusId)
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
    currentListener.statusAssignments = currentListener.statusAssignments.filter(entry => entry !== assignment);
    saveAppData();
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
    saveAppData();
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
    target.textContent = `対象リスナー: ${currentListener.name || "(名称未設定)"}`;
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
    const list = document.createElement("ul");
    list.className = "status-history-list";

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

      const state = document.createElement("span");
      state.className = "status-history-state";
      if (assignment.deactivatedAt) {
        state.classList.add("status-history-state--inactive");
        state.textContent = "解除済み";
      } else {
        state.classList.add("status-history-state--active");
        state.textContent = "現在有効";
      }
      header.appendChild(state);
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

      const actions = createActions(assignment);
      if (actions) item.appendChild(actions);

      const editor = createEditor(assignment);
      if (editor) item.appendChild(editor);

      list.appendChild(item);
    });

    container.appendChild(list);
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
  const urls = Array.isArray(currentListener && currentListener.urls) ? currentListener.urls : [];
  if (!urls.length) {
    container.textContent = "URLは登録されていません";
    return;
  }
  const list = document.createElement("ul");
  list.className = "listener-url-list";
  urls.forEach(url => {
    if (!url) return;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.appendChild(link);
    list.appendChild(item);
  });
  container.appendChild(list);
};

const renderListenerAttendances = () => {
  const empty = document.getElementById("listener-attendance-empty");
  const list = document.getElementById("listener-attendance-list");
  list.innerHTML = "";
  const entries = [];
  profiles.forEach(profile => {
    const streams = Array.isArray(profile.streams) ? profile.streams : [];
    streams.forEach(stream => {
      if (!Array.isArray(stream.attendees)) return;
      if (!stream.attendees.includes(currentListener.id)) return;
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
      currentProfile = profile;
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
  profiles.forEach(profile => {
    const streams = Array.isArray(profile.streams) ? profile.streams : [];
    streams.forEach(stream => {
      if (!Array.isArray(stream.gifts)) return;
      stream.gifts.forEach(gift => {
        if (!gift || !gift.listenerId) return;
        if (gift.listenerId === currentListener.id) records.push({ profile, stream, gift });
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
      currentProfile = profile;
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

const refreshListenerDetail = () => {
  if (!currentListener || !isListenerDetailActive()) return;
  document.getElementById("listener-name").textContent = currentListener.name;
  const membershipLabels = Array.isArray(currentListener.profileIds)
    ? currentListener.profileIds
        .map(pid => profiles.find(p => p.id === pid))
        .filter(p => Boolean(p))
        .map(formatProfileLabel)
    : [];
  document.getElementById("listener-profile").textContent = membershipLabels.length
    ? membershipLabels.join(" / ")
    : "紐付け済みプラットフォームなし";
  document.getElementById("listener-name-static").textContent = currentListener.name;
  document.getElementById("listener-memo").textContent = currentListener.memo
    ? currentListener.memo
    : "メモはまだ登録されていません";
  renderListenerUrls();
  renderListenerTags();
  renderListenerStatuses();
  renderListenerAttendances();
  renderListenerGifts();
};

const parseGiftAmount = amount => {
  if (!amount && amount !== 0) return null;
  const normalized = String(amount).replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const parseStreamDate = (dateStr, timeStr) => {
  if (!dateStr) return null;
  const normalizedDate = sanitizeDateInput(dateStr);
  if (!normalizedDate) return null;
  const normalizedTime = sanitizeTimeInput(timeStr);
  const base = normalizedTime ? `${normalizedDate}T${normalizedTime}` : `${normalizedDate}T00:00`;
  const parsed = new Date(base);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// === モーダル ===
const modalBg = document.getElementById("modal-bg");
const modalBody = document.getElementById("modal-body");
const modalTitle = document.getElementById("modal-title");
const modalHeaderActions = document.getElementById("modal-header-actions");

function openModal(title, fields, onSubmit) {
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
        const listId = `${f.name}-list`;
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
  modalBg.style.display = "flex";
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
    saveAppData();
    closeModal();
  };
}

const closeModal = () => {
  modalBg.style.display = "none";
  if (modalHeaderActions) modalHeaderActions.innerHTML = "";
  const okBtn = document.getElementById("modal-ok");
  if (okBtn) {
    okBtn.textContent = "OK";
    okBtn.onclick = null;
  }
};
document.getElementById("modal-cancel").onclick = closeModal;
modalBg.onclick = e => { if (e.target === modalBg) closeModal(); };

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
      streams: []
    };
    profiles.push(newProfile);
    renderPlatformList();
  });
  };
}

document.getElementById("add-stream").onclick = () => {
  openModal("配信追加", [
    { name: "title", label: "タイトル" },
    { name: "date", label: "配信日", type: "date" },
    { name: "startTime", label: "開始時刻（任意）", type: "time" },
    {
      name: "url",
      label: "配信 URL（任意）",
      type: "url",
      placeholder: "https://example.com"
    }
  ], v => {
    const newStream = sanitizeStream({
      id: generateId("s"),
      title: v.title,
      date: v.date,
      startTime: v.startTime,
      url: v.url,
      attendees: [],
      gifts: []
    });
    currentProfile.streams.push(newStream);
    renderStreams();
  });
};

const globalListenerSortSelect = document.getElementById("global-listener-sort");
if (globalListenerSortSelect) {
  globalListenerSortSelect.onchange = e => {
    listenerSortMode = e.target.value || "name-asc";
    renderDashboard();
  };
}

const listenerSortSelect = document.getElementById("listener-sort");
if (listenerSortSelect) {
  listenerSortSelect.onchange = e => {
    listenerSortMode = e.target.value || "name-asc";
    renderListenerList();
  };
}

const addListenerBtn = document.getElementById("add-listener-btn");
if (addListenerBtn) {
  addListenerBtn.onclick = () => {
    const profileOptions = profiles
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
  label: "紐付けるプラットフォーム（任意）",
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
      listeners.push(newListener);
      renderListenerList();
    });
  };
}

// === 配信詳細 ===
const openStream = id => {
  currentStream = currentProfile.streams.find(s => s.id === id);
  const titleElem = document.getElementById("stream-title");
  const scheduleElem = document.getElementById("stream-schedule");
  if (!currentStream) {
    titleElem.textContent = "";
    if (scheduleElem) scheduleElem.textContent = "";
    updateStreamUrlLink(null);
    return;
  }
  titleElem.textContent = currentStream.title || "無題の配信";
  if (scheduleElem) scheduleElem.textContent = formatStreamSchedule(currentStream);
  updateStreamUrlLink(currentStream);
  renderAttendees(); renderGifts();
  showView("stream-detail-view");
};

const renderAttendees = () => {
  const list = document.getElementById("attendee-list");
  list.innerHTML = "";
  if (!currentStream) return;
  const attendees = Array.isArray(currentStream.attendees) ? currentStream.attendees : [];
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
        size: "compact",
        limit: 1
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
      currentStream.attendees.splice(index, 1);
      saveAppData();
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

const openAttendeeEditModal = attendeeIndex => {
  if (!currentStream || attendeeIndex < 0) return;
  const currentListenerId = currentStream.attendees[attendeeIndex] || "";
  const currentListenerObj = currentListenerId ? getListenerById(currentListenerId) : null;
  const NEW_OPTION_VALUE = "__new_listener__";
  const baseListeners = getProfileListeners(currentProfile.id);
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
        profileIds: [currentProfile.id],
        urls: [],
        statusAssignments: []
      };
      listeners.push(newListener);
      currentStream.attendees[attendeeIndex] = newListener.id;
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
    linkListenerToProfile(listener, currentProfile.id);
    currentStream.attendees[attendeeIndex] = listener.id;
    renderAttendees();
    refreshCurrentView();
    refreshListenerDetail();
  });
};

const renderGifts = () => {
  const list = document.getElementById("gift-list");
  list.innerHTML = "";
  if (!currentStream) return;
  const gifts = Array.isArray(currentStream.gifts) ? currentStream.gifts : [];
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
      currentStream.gifts.splice(index, 1);
      saveAppData();
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

const openGiftEditModal = giftIndex => {
  if (!currentStream || giftIndex < 0) return;
  const gift = currentStream.gifts[giftIndex];
  if (!gift) return;
  const NEW_OPTION_VALUE = "__new_listener__";
  const baseListeners = getProfileListeners(currentProfile.id);
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
        profileIds: [currentProfile.id],
        urls: [],
        statusAssignments: []
      };
      listeners.push(newListener);
      targetListenerId = newListener.id;
    }
    const listener = getListenerById(targetListenerId);
    if (!listener) {
      alert("リスナーを選択してください");
      return;
    }
    linkListenerToProfile(listener, currentProfile.id);
    gift.listenerId = listener.id;
    gift.item = (values.item || "").trim();
    gift.amount = (values.amount || "").trim();
    renderGifts();
    refreshCurrentView();
    refreshListenerDetail();
  });
};

document.getElementById("add-attendee").onclick = () => {
  const NEW_OPTION_VALUE = "__new_listener__";
  const attendeeIds = new Set(Array.isArray(currentStream && currentStream.attendees) ? currentStream.attendees : []);
  const listenerEntries = getProfileListeners(currentProfile.id)
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
          const source = showAll ? listeners : getProfileListeners(currentProfile.id);
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
        profileIds: [currentProfile.id],
        urls: [],
        statusAssignments: []
      };
      listeners.push(newListener);
      currentStream.attendees.push(newListener.id);
      refreshCurrentView();
      renderAttendees();
      return;
    }
    const selectedListener = getListenerById(selectValue);
    if (!selectedListener) return;
    linkListenerToProfile(selectedListener, currentProfile.id);
    currentStream.attendees.push(selectedListener.id);
    renderAttendees();
    refreshCurrentView();
  });
};

document.getElementById("add-gift").onclick = () => {
  if (!currentProfile) return;
  const profileListeners = getProfileListeners(currentProfile.id);
  if (!profileListeners.length) {
    alert("リスナーが登録されていません。先にリスナーを追加してください。");
    return;
  }
  const TEMPLATE_CREATE_VALUE = "__create_template__";
  const listenerOptions = profileListeners.map(l => ({ value: l.id, label: l.name || "(名称未設定)" }));
  const templateOptions = [
    { value: "", label: "テンプレートを使用しない" },
    ...giftTemplates.map(template => ({ value: template.id, label: template.name || template.item || "テンプレート" })),
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
            const template = giftTemplates.find(t => t.id === selectedId);
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
      giftTemplates.push({
        id: generateId("gt"),
        name: templateName,
        item,
        amount
      });
      giftTemplates.sort((a, b) => nameCollator.compare(a.name || "", b.name || ""));
    }
    linkListenerToProfile(listener, currentProfile.id);
    currentStream.gifts.push({
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
const isStatusViewActive = () => Boolean(statusManagerRefs.view && statusManagerRefs.view.classList.contains("active"));

const maybeCloseStatusManagement = () => {
  if (!isStatusViewActive()) return true;
  if (hasUnsavedStatusChanges() && !confirmStatusDiscard()) return false;
  closeStatusManagement();
  return true;
};

const navigateHome = () => {
  if (!maybeCloseStatusManagement()) return;
  saveAppData();
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

document.getElementById("back-to-profiles").onclick = navigateHome;
document.getElementById("back-to-profile").onclick = ()=>{ saveAppData(); showView("profile-detail-view"); renderStreams(); };
document.getElementById("back-to-listeners").onclick = () => {
  navigateHome();
};

// 戻るボタン（専用ページ→ダッシュボード）
document.getElementById("back-to-dashboard-from-platform").onclick = navigateHome;
document.getElementById("back-to-dashboard-from-listener").onclick = navigateHome;

// 「すべて見る」ボタン
document.getElementById("dashboard-view-all-platforms").onclick = () => switchToTab('platform');
document.getElementById("dashboard-view-all-listeners").onclick = () => switchToTab('listener');
document.getElementById("listener-edit").onclick = () => {
  if (!currentListener) return;
  const urlsValue = Array.isArray(currentListener.urls) ? currentListener.urls.join("\n") : "";
  openModal("リスナー情報編集", [
    {
      name: "targetInfo",
      label: "編集対象",
      type: "static",
      value: currentListener.name || "(名称未設定)"
    },
    {
      name: "name",
      label: "リスナー名（必須）",
      value: currentListener.name || ""
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
      value: Array.isArray(currentListener.tags) ? currentListener.tags.join(", ") : ""
    },
    {
      name: "profileIds",
  label: "所属プラットフォーム（複数選択可）",
      type: "checkboxes",
      options: profiles
        .map(profile => ({ value: profile.id, label: formatProfileLabel(profile) }))
        .sort((a, b) => nameCollator.compare(a.label || "", b.label || "")),
      value: Array.isArray(currentListener.profileIds) ? [...currentListener.profileIds] : []
    },
    {
      name: "memo",
      label: "メモ（最大1000文字）",
      type: "textarea",
      value: currentListener.memo || ""
    }
  ], values => {
    const name = (values.name || "").trim();
    if (!name) {
      alert("リスナー名を入力してください");
      return;
    }
    const memo = values.memo ? values.memo.slice(0, 1000) : "";
    const selectedProfiles = Array.isArray(values.profileIds) ? values.profileIds : [];
    currentListener.name = name;
    currentListener.urls = normalizeListenerUrls(values.urls);
    currentListener.tags = parseTagsInput(values.tags);
    currentListener.memo = memo;
    currentListener.profileIds = selectedProfiles;
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
statusManagerRefs.view = document.getElementById("status-management-view");
if (statusManagerRefs.view) {
  statusManagerRefs.list = document.getElementById("status-list");
  statusManagerRefs.emptyMessage = document.getElementById("status-empty");
  statusManagerRefs.editorEmptyMessage = document.getElementById("status-editor-empty");
  statusManagerRefs.form = document.getElementById("status-editor-form");
  statusManagerRefs.id = document.getElementById("status-id");
  statusManagerRefs.displayName = document.getElementById("status-displayName");
  statusManagerRefs.description = document.getElementById("status-description");
  statusManagerRefs.displayPriority = document.getElementById("status-displayPriority");
  statusManagerRefs.isArchived = document.getElementById("status-isArchived");
  statusManagerRefs.archiveToggle = document.getElementById("status-archive-toggle-btn");
  statusManagerRefs.resetBtn = document.getElementById("status-reset-btn");
  statusManagerRefs.deleteBtn = document.getElementById("status-delete-btn");
  statusManagerRefs.saveBtn = document.getElementById("status-save-btn");
  statusManagerRefs.addBtn = document.getElementById("status-add-btn");
  statusManagerRefs.usageInfo = document.getElementById("status-usage-info");
  statusManagerRefs.filterState = document.getElementById("status-filter-state");
  statusManagerRefs.backBtn = document.getElementById("back-to-status-home");

  const handleFormChange = () => {
    if (statusFormSyncing) return;
    statusManagerState.formDirty = true;
    if (statusManagerRefs.resetBtn) statusManagerRefs.resetBtn.disabled = false;
    syncDraftFromForm();
    updateStatusArchiveToggleLabel();
    renderStatusList();
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
      if (!statusManagerRefs.isArchived) return;
      statusManagerRefs.isArchived.checked = !statusManagerRefs.isArchived.checked;
      statusManagerState.formDirty = true;
      syncDraftFromForm();
      updateStatusArchiveToggleLabel();
      renderStatusList();
    };
  }

  if (statusManagerRefs.resetBtn) statusManagerRefs.resetBtn.onclick = () => discardStatusChanges();
  if (statusManagerRefs.deleteBtn) statusManagerRefs.deleteBtn.onclick = () => removeStatusDefinition();
  if (statusManagerRefs.addBtn) statusManagerRefs.addBtn.onclick = () => beginCreateStatus();
  if (statusManagerRefs.filterState) statusManagerRefs.filterState.onchange = event => {
    statusManagerState.stateFilter = event.target.value || "active";
    renderStatusList();
  };
  if (statusManagerRefs.backBtn) statusManagerRefs.backBtn.onclick = () => {
    if (!confirmStatusDiscard()) return;
    closeStatusManagement();
    navigateHome();
  };

  resetStatusManager();
  renderStatusList();
}

const requestOpenStatusManagement = () => {
  const menuElement = document.getElementById("menu");
  if (menuElement) menuElement.style.display = "none";
  if (statusManagerRefs.view && statusManagerRefs.view.classList.contains("active") && hasUnsavedStatusChanges()) {
    if (!confirmStatusDiscard()) return false;
  }
  openStatusManagement();
  return true;
};

const menu=document.getElementById("menu"), menuBtn=document.getElementById("menu-button");
menuBtn.onclick=()=>{menu.style.display=menu.style.display==="block"?"none":"block";};
document.body.onclick=e=>{if(!menu.contains(e.target)&&e.target!==menuBtn)menu.style.display="none";};

document.getElementById("export-btn").onclick=()=>{
  const payload={
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles,
    listeners,
    statusCatalog,
    giftTemplates
  };
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
        const parsed=JSON.parse(reader.result);
        const normalized=normalizeData(parsed);
        profiles=normalized.profiles;
        listeners=normalized.listeners;
    statusCatalog=Array.isArray(normalized.statusCatalog)?normalized.statusCatalog:[];
    schemaVersion=Number.isFinite(normalized.schemaVersion)?normalized.schemaVersion:CURRENT_SCHEMA_VERSION;
    giftTemplates=normalized.giftTemplates;
        currentProfile=null;
        currentStream=null;
        currentListener=null;
    renderStatusList();
        saveAppData();
        renderDashboard();
        showView("dashboard-view");
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
  profiles=defaults.profiles;
  listeners=defaults.listeners;
  statusCatalog=defaults.statusCatalog;
  giftTemplates=defaults.giftTemplates;
  schemaVersion=defaults.schemaVersion;
  currentProfile=null;
  currentStream=null;
  currentListener=null;
  renderStatusList();
  saveAppData();
  renderDashboard();
  showView("dashboard-view");
  menu.style.display="none";
  alert("データを初期化しました");
};

// === 起動 ===
openDB().then(async()=>{
  const loaded=await loadAppData();
  profiles=loaded.profiles;
  listeners=loaded.listeners;
  statusCatalog=Array.isArray(loaded.statusCatalog)?loaded.statusCatalog:[];
  schemaVersion=Number.isFinite(loaded.schemaVersion)?loaded.schemaVersion:CURRENT_SCHEMA_VERSION;
  giftTemplates=Array.isArray(loaded.giftTemplates)?loaded.giftTemplates:createDefaultGiftTemplates();
  if(profiles.length===0&&listeners.length===0){
    const defaults=createDefaultData();
    profiles=defaults.profiles;
    listeners=defaults.listeners;
    statusCatalog=defaults.statusCatalog;
    giftTemplates=defaults.giftTemplates;
    schemaVersion=defaults.schemaVersion;
    saveAppData();
  }
  renderDashboard();
  initTabNavigation();
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

function updateTabState(target) {
  // すべてのタブボタンの選択状態を解除
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const btnTarget = btn.getAttribute('data-page-target');
    if (btnTarget === target) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    }
  });
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
