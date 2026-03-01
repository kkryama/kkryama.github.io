// BondLog トップリスナーランキングモジュール
// 参加率・ギフト金額によるリスナーランキングを算出・表示する

import {
  parseStreamDate, formatDateTimeForDisplay, formatProfileLabel,
  parseGiftAmount, nameCollator, numberFormatter
} from "./utils.js";
import { state, getListenerById } from "./state.js";
import { getActiveStatusEntries, populateStatusContainer } from "./status-badge.js";
// 循環依存あり: listener.js（ランタイム参照のみ、モジュール評価時には使用しない）
import { openListener } from "./listener.js";

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

export const buildLatestAttendanceMapAll = () => {
  const map = new Map();
  state.profiles.forEach(profile => {
    const eachMap = buildLatestAttendanceMap(profile);
    eachMap.forEach((timestamp, listenerId) => {
      const prev = map.get(listenerId);
      if (prev === undefined || prev < timestamp) map.set(listenerId, timestamp);
    });
  });
  return map;
};

const ensureTopListenerFilterHandlers = (periodSelect, platformSelect) => {
  if (periodSelect && !periodSelect.dataset.topListenerBound) {
    periodSelect.addEventListener("change", () => {
      state.topListenerPeriodFilter = periodSelect.value || "30";
      renderTopListenerSection();
    });
    periodSelect.dataset.topListenerBound = "true";
  }
  if (platformSelect && !platformSelect.dataset.topListenerBound) {
    platformSelect.addEventListener("change", () => {
      state.topListenerPlatformFilter = platformSelect.value || "all";
      renderTopListenerSection();
    });
    platformSelect.dataset.topListenerBound = "true";
  }
};

const populateTopListenerPlatformOptions = select => {
  if (!select) return;
  const desiredValue = state.topListenerPlatformFilter;
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "すべてのプラットフォーム";
  fragment.appendChild(allOption);

  const sortedProfiles = [...state.profiles].sort((a, b) => nameCollator.compare(formatProfileLabel(a), formatProfileLabel(b)));
  sortedProfiles.forEach(profile => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = formatProfileLabel(profile);
    fragment.appendChild(option);
  });

  select.innerHTML = "";
  select.appendChild(fragment);
  if (desiredValue && select.querySelector(`option[value="${desiredValue}"]`)) {
    select.value = desiredValue;
  } else {
    select.value = "all";
  }
};

const collectTopListenerStreams = (periodValue, platformValue) => {
  const days = periodValue === "all" ? null : Number.parseInt(periodValue, 10);
  let cutoff = null;
  if (Number.isFinite(days) && days > 0) {
    cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
  }

  const targetProfiles = platformValue === "all"
    ? state.profiles
    : state.profiles.filter(profile => profile.id === platformValue);

  const entries = [];
  targetProfiles.forEach(profile => {
    if (!profile || !Array.isArray(profile.streams)) return;
    profile.streams.forEach(stream => {
      const parsedDate = parseStreamDate(stream.date, stream.startTime);
      if (!parsedDate) return;
      if (cutoff && parsedDate < cutoff) return;
      entries.push({ profile, stream, parsedDate });
    });
  });
  return entries;
};

const createTopListenerRow = (listener, metricText, latestText) => {
  const li = document.createElement("li");
  li.className = "top-listener-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "top-listener-row";
  button.onclick = () => openListener(listener.id);
  button.title = `${listener.name || "(名称未設定)"} - ${metricText}`;

  const header = document.createElement("div");
  header.className = "top-listener-row-header";

  const nameEl = document.createElement("span");
  nameEl.className = "list-title";
  nameEl.textContent = listener.name || "(名称未設定)";
  header.appendChild(nameEl);

  const statusContainer = document.createElement("div");
  const hasStatus = populateStatusContainer(statusContainer, getActiveStatusEntries(listener), { showEmpty: false, size: "compact" });
  if (hasStatus) {
    statusContainer.classList.add("top-listener-row-statuses");
    header.appendChild(statusContainer);
  }

  const body = document.createElement("div");
  body.className = "top-listener-row-body";

  const metricEl = document.createElement("div");
  metricEl.className = "top-listener-row-metric";
  metricEl.textContent = metricText;
  body.appendChild(metricEl);

  const latestEl = document.createElement("div");
  latestEl.className = "top-listener-row-latest";
  latestEl.textContent = latestText;
  body.appendChild(latestEl);

  button.appendChild(header);
  button.appendChild(body);
  li.appendChild(button);
  return li;
};

const renderTopListenerAttendanceRanking = (streamEntries, listElement, emptyElement) => {
  listElement.innerHTML = "";
  if (!Array.isArray(streamEntries)) {
    emptyElement.textContent = "期間内に対象となる配信がありません";
    emptyElement.style.display = "block";
    return;
  }

  const totalStreams = streamEntries.length;
  if (totalStreams === 0) {
    emptyElement.textContent = "期間内に対象となる配信がありません";
    emptyElement.style.display = "block";
    return;
  }

  const stats = new Map();
  streamEntries.forEach(({ stream, parsedDate }) => {
    const attendees = Array.isArray(stream.attendees) ? stream.attendees : [];
    attendees.forEach(listenerId => {
      if (!listenerId) return;
      const listener = getListenerById(listenerId);
      if (!listener) return;
      const existing = stats.get(listener.id) || { listener, count: 0, latest: null };
      existing.count += 1;
      if (!existing.latest || existing.latest < parsedDate) existing.latest = parsedDate;
      stats.set(listener.id, existing);
    });
  });

  if (stats.size === 0) {
    emptyElement.textContent = "期間内に参加したリスナーがまだいません";
    emptyElement.style.display = "block";
    return;
  }

  emptyElement.style.display = "none";
  const ranking = [...stats.values()].sort((a, b) => {
    const aRate = a.count / totalStreams;
    const bRate = b.count / totalStreams;
    if (bRate !== aRate) return bRate - aRate;
    if (b.count !== a.count) return b.count - a.count;
    return nameCollator.compare((a.listener.name || "").trim(), (b.listener.name || "").trim());
  }).slice(0, 5);

  ranking.forEach(entry => {
    const ratePercent = ((entry.count / totalStreams) * 100).toFixed(1);
    const metricText = `参加率 ${ratePercent}% (${entry.count}/${totalStreams})`;
    const latestText = entry.latest
      ? `最終参加: ${formatDateTimeForDisplay(entry.latest.toISOString())}`
      : "最終参加: 記録なし";
    listElement.appendChild(createTopListenerRow(entry.listener, metricText, latestText));
  });
};

const renderTopListenerGiftRanking = (streamEntries, listElement, emptyElement) => {
  listElement.innerHTML = "";
  if (!Array.isArray(streamEntries) || streamEntries.length === 0) {
    emptyElement.textContent = "期間内に対象となる配信がありません";
    emptyElement.style.display = "block";
    return;
  }

  const stats = new Map();
  let hasGiftRecords = false;
  streamEntries.forEach(({ stream, parsedDate }) => {
    const gifts = Array.isArray(stream.gifts) ? stream.gifts : [];
    if (gifts.length > 0) hasGiftRecords = true;
    gifts.forEach(gift => {
      if (!gift || !gift.listenerId) return;
      const amount = parseGiftAmount(gift.amount);
      if (amount === null) return;
      const listener = getListenerById(gift.listenerId);
      if (!listener) return;
      const existing = stats.get(listener.id) || { listener, totalAmount: 0, latest: null };
      existing.totalAmount += amount;
      if (!existing.latest || existing.latest < parsedDate) existing.latest = parsedDate;
      stats.set(listener.id, existing);
    });
  });

  if (stats.size === 0) {
    emptyElement.textContent = hasGiftRecords ? "金額未入力のギフトのみです" : "期間内のギフト記録がありません";
    emptyElement.style.display = "block";
    return;
  }

  emptyElement.style.display = "none";
  const ranking = [...stats.values()].sort((a, b) => {
    if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
    const aTime = a.latest ? a.latest.getTime() : 0;
    const bTime = b.latest ? b.latest.getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return nameCollator.compare((a.listener.name || "").trim(), (b.listener.name || "").trim());
  }).slice(0, 5);

  ranking.forEach(entry => {
    const metricText = `合計 ${numberFormatter.format(Math.round(entry.totalAmount))}`;
    const latestText = entry.latest
      ? `最新ギフト: ${formatDateTimeForDisplay(entry.latest.toISOString())}`
      : "最新ギフト: 記録なし";
    listElement.appendChild(createTopListenerRow(entry.listener, metricText, latestText));
  });
};

export const renderTopListenerSection = () => {
  const periodSelect = document.getElementById("top-listener-filter-period");
  const platformSelect = document.getElementById("top-listener-filter-platform");
  const attendanceList = document.getElementById("top-listener-attendance-list");
  const attendanceEmpty = document.getElementById("top-listener-attendance-empty");
  const giftList = document.getElementById("top-listener-gift-list");
  const giftEmpty = document.getElementById("top-listener-gift-empty");
  const loading = document.getElementById("top-listener-loading");

  if (!periodSelect || !platformSelect || !attendanceList || !attendanceEmpty || !giftList || !giftEmpty) return;
  if (loading) loading.hidden = true;

  populateTopListenerPlatformOptions(platformSelect);

  const availablePeriods = Array.from(periodSelect.options).map(opt => opt.value);
  if (!availablePeriods.includes(state.topListenerPeriodFilter)) {
    state.topListenerPeriodFilter = periodSelect.value || availablePeriods[0] || "30";
  }
  periodSelect.value = state.topListenerPeriodFilter;

  if (!platformSelect.querySelector(`option[value="${state.topListenerPlatformFilter}"]`)) {
    state.topListenerPlatformFilter = "all";
  }
  platformSelect.value = state.topListenerPlatformFilter;

  state.topListenerPeriodFilter = periodSelect.value || "30";
  state.topListenerPlatformFilter = platformSelect.value || "all";

  ensureTopListenerFilterHandlers(periodSelect, platformSelect);

  const streamEntries = collectTopListenerStreams(state.topListenerPeriodFilter, state.topListenerPlatformFilter);
  renderTopListenerAttendanceRanking(streamEntries, attendanceList, attendanceEmpty);
  renderTopListenerGiftRanking(streamEntries, giftList, giftEmpty);
};
