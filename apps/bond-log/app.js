const DB_NAME = "BondLogDB";
const STORE_NAME = "profiles";
let db,
  profiles = [],
  listeners = [],
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

const sanitizeUrlInput = raw => {
  if (!raw) return "";
  return String(raw).trim().slice(0, 2048);
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

const createDefaultData = () => ({ profiles: [], listeners: [], giftTemplates: createDefaultGiftTemplates() });

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
  tx.objectStore(STORE_NAME).put({ id: "main", data: { profiles, listeners, giftTemplates } });
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
  if (!listener || typeof listener !== "object") return { id: generateId("l"), name: "", tags: [], memo: "", profileIds: [], urls: [] };
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
  return {
    id,
    name,
    tags,
    memo,
    profileIds,
    urls: normalizeListenerUrls(listener.urls)
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
  return { profiles: migratedProfiles, listeners: migratedListeners, giftTemplates: createDefaultGiftTemplates() };
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
  return {
    profiles: raw.profiles.map(sanitizeProfile),
    listeners: raw.listeners.map(sanitizeListener),
    giftTemplates: sanitizedTemplates
  };
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

const renderProfiles = () => {
  const list = document.getElementById("profile-list");
  const emptyState = document.getElementById("profile-empty");
  
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
    actions.appendChild(createActionButton("編集", "", () => openProfileEditor(profile)));
    actions.appendChild(createActionButton("削除", "danger", () => confirmDeleteProfile(profile)));
    header.appendChild(actions);

    li.appendChild(header);
    li.onclick = () => openProfile(profile.id);
    list.appendChild(li);
  });
  renderGlobalListeners();
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
    renderProfiles();
    if (currentProfile && currentProfile.id === profile.id) {
      currentProfile.platform = profile.platform;
      currentProfile.accountName = profile.accountName;
      currentProfile.url = profile.url;
      currentProfile.note = profile.note;
  document.getElementById("profile-title").textContent = formatProfileLabel(currentProfile);
  renderStreams();
  renderGlobalListeners();
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
    showView("profile-list-view");
  }
  saveAppData();
  renderProfiles();
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
    actions.appendChild(createActionButton("編集", "", () => openStreamEditor(stream)));
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
    renderGlobalListeners();
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
  renderGlobalListeners();
  refreshListenerDetail();
};

const renderGlobalListeners = () => {
  const list = document.getElementById("global-listener-list");
  const emptyMessage = document.getElementById("global-listener-empty");
  if (!list || !emptyMessage) return;
  list.innerHTML = "";
  const latestAttendanceMap = buildLatestAttendanceMapAll();
  const sortSelect = document.getElementById("global-listener-sort");
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

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = listener.name || "(名称未設定)";
    header.appendChild(title);

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

function openModal(title, fields, onSubmit) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  fields.forEach(f => {
    const wrapper = document.createElement("div");
    wrapper.className = "modal-field";
    if (f.hidden) wrapper.style.display = "none";
    const labelText = f.label || "";
    if (labelText) {
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
    if (f.value !== undefined && !["static", "checkboxes"].includes(f.type || "")) {
      element.value = f.value;
    }
    wrapper.appendChild(element);
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

const closeModal = () => modalBg.style.display = "none";
document.getElementById("modal-cancel").onclick = closeModal;
modalBg.onclick = e => { if (e.target === modalBg) closeModal(); };

// === イベント ===
document.getElementById("add-profile-btn").onclick = () => {
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
    renderProfiles();
  });
};

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

document.getElementById("add-listener").onclick = () => {
  const NEW_OPTION_VALUE = "__new_listener__";
  const availableExisting = listeners.filter(listener => {
    if (!Array.isArray(listener.profileIds)) return true;
    return !listener.profileIds.includes(currentProfile.id);
  });
  const listenerOptions = [
    { value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを登録" },
    ...availableExisting.map(listener => {
      const memberships = Array.isArray(listener.profileIds)
        ? listener.profileIds
            .map(pid => profiles.find(p => p.id === pid))
            .filter(p => Boolean(p))
            .map(formatProfileLabel)
        : [];
      const suffix = memberships.length ? `（所属: ${memberships.join("、")}）` : "";
      return {
        value: listener.id,
        label: `${listener.name || "(名称未設定)"}${suffix}`
      };
    })
  ];
  openModal("リスナー追加", [
    {
      name: "listenerSelect",
      label: "登録方法",
      type: "select",
      options: listenerOptions,
      onCreate: (element, wrapper) => {
        wrapper.dataset.field = "listenerSelect";
        const toggleInputs = () => {
          const nameWrap = modalBody.querySelector('[data-field="listenerName"]');
          const tagsWrap = modalBody.querySelector('[data-field="listenerTags"]');
          const memoWrap = modalBody.querySelector('[data-field="listenerMemo"]');
          const isNew = element.value === NEW_OPTION_VALUE;
          [nameWrap, tagsWrap, memoWrap].forEach(w => { if (w) w.style.display = isNew ? "" : "none"; });
        };
        element.addEventListener("change", toggleInputs);
        toggleInputs();
      }
    },
    {
      name: "name",
      label: "リスナー名",
      onCreate: (_element, wrapper) => { wrapper.dataset.field = "listenerName"; }
    },
    {
      name: "tags",
      label: "タグ（カンマ区切り）",
      onCreate: (_element, wrapper) => { wrapper.dataset.field = "listenerTags"; }
    },
    {
      name: "memo",
      label: "メモ（任意）",
      type: "textarea",
      onCreate: (_element, wrapper) => { wrapper.dataset.field = "listenerMemo"; }
    }
  ], values => {
    const mode = values.listenerSelect;
    if (mode === NEW_OPTION_VALUE) {
      const name = (values.name || "").trim();
      if (!name) {
        alert("リスナー名を入力してください");
        return;
      }
      const newListener = {
        id: generateId("l"),
        name,
        tags: parseTagsInput(values.tags),
        memo: (values.memo || "").slice(0, 1000),
        profileIds: [currentProfile.id],
        urls: []
      };
      listeners.push(newListener);
      renderGlobalListeners();
      return;
    }
    const target = getListenerById(mode);
    if (!target) {
      alert("既存リスナーの取得に失敗しました");
      return;
    }
    linkListenerToProfile(target, currentProfile.id);
    renderGlobalListeners();
  });
};

const globalListenerSortSelect = document.getElementById("global-listener-sort");
if (globalListenerSortSelect) {
  globalListenerSortSelect.onchange = e => {
    listenerSortMode = e.target.value || "name-asc";
    renderGlobalListeners();
  };
}

const globalAddListenerBtn = document.getElementById("global-add-listener");
if (globalAddListenerBtn) {
  globalAddListenerBtn.onclick = () => {
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
        urls: normalizeListenerUrls(values.urls)
      };
      listeners.push(newListener);
      renderGlobalListeners();
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

    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = listener ? listener.name : "不明なリスナー";
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    actions.appendChild(createActionButton("編集", "", () => openAttendeeEditModal(index)));
    actions.appendChild(createActionButton("削除", "danger", () => {
      const targetName = listener ? listener.name : "この参加者";
      if (!confirm(`${targetName} を参加者一覧から削除しますか？`)) return;
      currentStream.attendees.splice(index, 1);
      saveAppData();
      renderAttendees();
      renderGlobalListeners();
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
        urls: []
      };
      listeners.push(newListener);
      currentStream.attendees[attendeeIndex] = newListener.id;
      renderGlobalListeners();
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
    renderGlobalListeners();
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
    actions.appendChild(createActionButton("編集", "", () => openGiftEditModal(index)));
    actions.appendChild(createActionButton("削除", "danger", () => {
      const targetLabel = listener ? `${listenerName} のギフト` : "このギフト";
      if (!confirm(`${targetLabel} を削除しますか？`)) return;
      currentStream.gifts.splice(index, 1);
      saveAppData();
      renderGifts();
      renderGlobalListeners();
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
        urls: []
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
    renderGlobalListeners();
    refreshListenerDetail();
  });
};

document.getElementById("add-attendee").onclick = () => {
  const NEW_OPTION_VALUE = "__new_listener__";
  const listenerEntries = getProfileListeners(currentProfile.id).map(l => ({ id: l.id, name: l.name || "" }));
  const hasExisting = listenerEntries.length > 0;
  openModal("参加者追加", [
    {
      name: "listenerSelect",
      label: "リスナーを選択",
      type: "select",
      options: hasExisting
        ? [...listenerEntries.map(entry => ({ value: entry.id, label: entry.name || "(名称未設定)" })), { value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを追加" }]
        : [{ value: NEW_OPTION_VALUE, label: "＋ 新規リスナーを追加" }],
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
  const newListener = { id: generateId("l"), name: newName, tags: [], memo: "", profileIds: [currentProfile.id], urls: [] };
      listeners.push(newListener);
      currentStream.attendees.push(newListener.id);
      renderGlobalListeners();
      renderAttendees();
      return;
    }
    const selectedListener = getListenerById(selectValue);
    if (!selectedListener) return;
    linkListenerToProfile(selectedListener, currentProfile.id);
    currentStream.attendees.push(selectedListener.id);
    renderAttendees();
    renderGlobalListeners();
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
    renderGlobalListeners();
    refreshListenerDetail();
  });
};

// === 戻る・メニュー ===
const navigateHome = () => {
  saveAppData();
  showView("profile-list-view");
  renderProfiles();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
    renderGlobalListeners();
  });
};

// === メニュー ===
const menu=document.getElementById("menu"), menuBtn=document.getElementById("menu-button");
menuBtn.onclick=()=>{menu.style.display=menu.style.display==="block"?"none":"block";};
document.body.onclick=e=>{if(!menu.contains(e.target)&&e.target!==menuBtn)menu.style.display="none";};

document.getElementById("export-btn").onclick=()=>{
  const payload={profiles,listeners,giftTemplates};
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
  giftTemplates=normalized.giftTemplates;
        currentProfile=null;
        currentStream=null;
        currentListener=null;
        saveAppData();
        renderProfiles();
        showView("profile-list-view");
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
  giftTemplates=defaults.giftTemplates;
  currentProfile=null;
  currentStream=null;
  currentListener=null;
  saveAppData();
  renderProfiles();
  showView("profile-list-view");
  menu.style.display="none";
  alert("データを初期化しました");
};

// === 起動 ===
openDB().then(async()=>{
  const loaded=await loadAppData();
  profiles=loaded.profiles;
  listeners=loaded.listeners;
  giftTemplates=Array.isArray(loaded.giftTemplates)?loaded.giftTemplates:createDefaultGiftTemplates();
  if(profiles.length===0&&listeners.length===0){
    const defaults=createDefaultData();
    profiles=defaults.profiles;
    listeners=defaults.listeners;
    giftTemplates=defaults.giftTemplates;
    saveAppData();
  }
  renderProfiles();
});
