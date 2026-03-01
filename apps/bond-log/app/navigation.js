// BondLog ナビゲーション・共通UIモジュール
// ビュー切替、タブ制御、折りたたみUI、フッター余白

import { state } from "./state.js";

// --- ビュー ---

/**
 * ビューIDからページタイトルを取得
 */
export const getViewTitle = id => {
  switch(id) {
    case "dashboard-view":
      return "BondLog";
    case "platform-list-view":
      return "プラットフォーム一覧 - BondLog";
    case "listener-list-view":
      return "リスナー一覧 - BondLog";
    case "profile-detail-view":
      return state.currentProfile ? `${state.currentProfile.platform} ${state.currentProfile.accountName} - BondLog` : "プラットフォーム詳細 - BondLog";
    case "listener-detail-view":
      return state.currentListener ? `${state.currentListener.name} - BondLog` : "リスナー詳細 - BondLog";
    case "stream-detail-view":
      return "配信詳細 - BondLog";
    case "status-list-view":
      return "ステータス管理 - BondLog";
    case "status-detail-view":
      return "ステータス詳細 - BondLog";
    default:
      return "BondLog";
  }
};

/**
 * 指定ビューをアクティブにし、タイトルを更新
 */
export const showView = id => {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.title = getViewTitle(id);
};

// --- ビューリフレッシュレジストリ ---

const viewRefreshers = {};

/**
 * ビューIDごとのリフレッシュ関数を登録
 */
export function registerViewRefresher(viewId, fn) {
  viewRefreshers[viewId] = fn;
}

/**
 * 現在表示中のビューに応じて適切なレンダリング関数を呼び出す
 */
export const refreshCurrentView = () => {
  const activeView = document.querySelector(".view.active");
  if (!activeView) return;
  const refresher = viewRefreshers[activeView.id];
  if (refresher) refresher();
};

// --- タブ ---

/**
 * メインタブボタンの選択状態を更新
 */
export function updateTabState(target) {
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

/**
 * ローカルタブの切替
 */
export function switchLocalTab(target) {
  document.querySelectorAll('.local-tab-btn').forEach(btn => {
    const btnTarget = btn.getAttribute('data-tab');
    if (btnTarget === target) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  document.querySelectorAll('.local-tab-content').forEach(content => {
    const contentId = content.getAttribute('id');
    if (contentId === `tab-content-${target}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// --- 共通UIヘルパー ---

/**
 * リスト項目用のアクションボタンを生成
 */
export const createActionButton = (label, extraClass, handler) => {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className = extraClass ? `list-action-btn ${extraClass}` : "list-action-btn";
  btn.onclick = e => {
    e.stopPropagation();
    handler(e);
  };
  return btn;
};


/**
 * セクションの折りたたみ状態を設定
 */
export function setCollapsibleState(section, content, toggleBtn, isCollapsed) {
  section.classList.toggle('collapsed', isCollapsed);
  content.hidden = isCollapsed;
  toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
}

/**
 * ダッシュボードセクションの折りたたみを初期化
 */
export function initDashboardCollapsibles() {
  const sections = document.querySelectorAll('.home-section[data-collapsible-id]');
  sections.forEach(section => {
    const toggleBtn = section.querySelector('.section-toggle');
    const content = section.querySelector('.home-section-content');
    if (!toggleBtn || !content) {
      return;
    }
    const storageKey = `bondlog:dashboard:section:${section.dataset.collapsibleId}`;
    const savedState = localStorage.getItem(storageKey);
    const startCollapsed = savedState === 'true';
    setCollapsibleState(section, content, toggleBtn, startCollapsed);
    toggleBtn.addEventListener('click', () => {
      const nextCollapsed = !section.classList.contains('collapsed');
      setCollapsibleState(section, content, toggleBtn, nextCollapsed);
      localStorage.setItem(storageKey, String(nextCollapsed));
    });
  });
}

// --- フッター余白 ---

let footerSafeSpaceObserver = null;
let footerSafeSpaceResizeBound = false;

/**
 * フッターの高さに応じてメイン領域の余白を確保する
 */
export function initFooterSafeSpace() {
  const footer = document.querySelector('footer');
  const root = document.documentElement;
  if (!footer || !root) {
    return;
  }

  const recomputeSafeSpace = () => {
    const footerRect = footer.getBoundingClientRect();
    const footerHeight = Number.isFinite(footerRect?.height) ? footerRect.height : 0;
    const safeSpacePx = Math.ceil(footerHeight + 24);
    root.style.setProperty('--footer-safe-space', `${safeSpacePx}px`);
  };

  recomputeSafeSpace();

  if (!footerSafeSpaceResizeBound) {
    window.addEventListener('resize', recomputeSafeSpace);
    footerSafeSpaceResizeBound = true;
  }

  if (typeof ResizeObserver === 'function') {
    if (footerSafeSpaceObserver) {
      footerSafeSpaceObserver.disconnect();
    }
    footerSafeSpaceObserver = new ResizeObserver(() => recomputeSafeSpace());
    footerSafeSpaceObserver.observe(footer);
  }

  footer.querySelectorAll('details').forEach(detail => {
    if (detail.dataset.footerSafeSpaceBound === 'true') return;
    detail.addEventListener('toggle', recomputeSafeSpace);
    detail.dataset.footerSafeSpaceBound = 'true';
  });
}
