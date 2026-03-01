// BondLog ダッシュボードモジュール
// ダッシュボード画面の描画を管理する

import { formatProfileLabel } from "./utils.js";
import { state } from "./state.js";
import { renderFollowerCharts } from "./chart.js";
import { renderTopListenerSection } from "./top-listener.js";
// 循環依存あり: platform.js（ランタイム参照のみ、モジュール評価時には使用しない）
import { openProfile } from "./platform.js";

export const renderDashboard = () => {
  // プラットフォームの簡易表示（最大3件）
  const dashboardProfileList = document.getElementById("dashboard-profile-list");
  const dashboardProfileEmpty = document.getElementById("dashboard-profile-empty");

  if (dashboardProfileList && dashboardProfileEmpty) {
    dashboardProfileList.innerHTML = "";
    const platformPreview = state.profiles.slice(0, 3);

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

  // 登録者数の推移グラフを描画
  renderTopListenerSection();
  renderFollowerCharts(state.profiles);
};
