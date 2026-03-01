// BondLog 登録者推移グラフモジュール
// Chart.js を使用した登録者数推移グラフの描画

// Chart.js は CDN からグローバルに読み込まれる前提（window.Chart）

// --- 内部状態 ---
const followerCharts = {};
let currentChartDuration = 'all';

/**
 * グラフの表示期間を設定する
 * @param {string} duration - 期間（'all', '30', '90', '180' 等）
 */
export function setChartDuration(duration) {
  currentChartDuration = duration;
}

/**
 * データを整形し、期間でフィルタリングする
 */
export function prepareAndFilterChartData(history, duration) {
  if (!history || !Array.isArray(history) || history.length < 1) {
    return { dates: [], counts: [] };
  }

  // 日付順にソート
  const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  let filteredHistory = sortedHistory;

  // 期間フィルタ適用
  if (duration !== 'all') {
    const days = parseInt(duration, 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    filteredHistory = sortedHistory.filter(item => new Date(item.date) >= cutoffDate);
  }

  return {
    dates: filteredHistory.map(item => item.date),
    counts: filteredHistory.map(item => parseInt(item.count, 10))
  };
}

/**
 * グラフを描画するメイン関数
 * @param {Array} profileList - プロファイル配列
 */
export function renderFollowerCharts(profileList) {
  const container = document.getElementById('dashboard-follower-charts-container');
  if (!container) return;

  // メモリリーク防止のため既存グラフを破棄
  Object.keys(followerCharts).forEach(key => {
    if (followerCharts[key]) followerCharts[key].destroy();
  });
  container.innerHTML = '';

  const validProfiles = profileList.filter(p => p.followerHistory && p.followerHistory.length > 0);
  if (validProfiles.length === 0) {
    container.innerHTML = '<p class="empty-state">まだ登録者履歴を持つプラットフォームがありません</p>';
    return;
  }

  validProfiles.forEach(profile => {
    const { dates, counts } = prepareAndFilterChartData(profile.followerHistory, currentChartDuration);

    // カード生成
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<h3 class="chart-card-title">${profile.accountName} (${profile.platform})</h3>`;

    // データ不足チェック
    if (counts.length < 2) {
      const msg = document.createElement('p');
      msg.className = 'empty-state';
      msg.style.fontSize = '0.85rem';
      msg.textContent = `データ不足（${counts.length}件）。グラフ表示には2件以上の記録が必要です。`;
      card.appendChild(msg);
      container.appendChild(card);
      return;
    }

    // Canvas生成
    const canvasContainer = document.createElement('div');
    canvasContainer.style.position = 'relative';
    canvasContainer.style.height = '300px';
    canvasContainer.style.width = '100%';

    const canvas = document.createElement('canvas');
    canvas.id = `chart-${profile.id}`;
    canvas.className = 'follower-chart-canvas';
    canvasContainer.appendChild(canvas);
    card.appendChild(canvasContainer);
    container.appendChild(card);

    // Chart.js インスタンス生成
    const ctx = canvas.getContext('2d');
    followerCharts[profile.id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: '登録者数',
          data: counts,
          borderColor: '#20c997',
          backgroundColor: 'rgba(32, 201, 151, 0.1)',
          borderWidth: 2,
          tension: 0.1,
          fill: true,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day', displayFormats: { day: 'MM/dd' }, tooltipFormat: 'yyyy/MM/dd' },
            title: { display: true, text: '日付' }
          },
          y: { beginAtZero: false, ticks: { precision: 0 } }
        },
        plugins: { legend: { display: false } }
      }
    });
  });
}
