const READONLY_STORAGE_KEY = "check-matrix-readonly-mode";

function getDefaultStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch (error) {
    console.warn("読み取り専用状態の保存領域にアクセスできません", error);
    return null;
  }
}

function loadReadOnlyPreference(storage = getDefaultStorage()) {
  if (!storage) {
    return false;
  }
  try {
    const stored = storage.getItem(READONLY_STORAGE_KEY);
    if (stored == null) {
      return false;
    }
    if (stored === "true" || stored === "1") {
      return true;
    }
    if (stored === "false" || stored === "0") {
      return false;
    }
    return stored.trim().toLowerCase() === "yes";
  } catch (error) {
    console.warn("読み取り専用状態の復元に失敗しました", error);
    return false;
  }
}

function saveReadOnlyPreference(value, storage = getDefaultStorage()) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(READONLY_STORAGE_KEY, value ? "true" : "false");
  } catch (error) {
    console.warn("読み取り専用状態の保存に失敗しました", error);
  }
}

function createReadOnlyGuard(isReadOnly, alertFn = () => {}) {
  if (typeof isReadOnly !== "function") {
    throw new TypeError("isReadOnly は関数である必要があります");
  }
  const notify = typeof alertFn === "function" ? alertFn : () => {};
  return function guardReadOnly(event) {
    if (!isReadOnly()) {
      return false;
    }
    if (event?.preventDefault) {
      event.preventDefault();
    }
    if (event?.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    } else if (event?.stopPropagation) {
      event.stopPropagation();
    }
    notify();
    return true;
  };
}

export { READONLY_STORAGE_KEY, loadReadOnlyPreference, saveReadOnlyPreference, createReadOnlyGuard };
