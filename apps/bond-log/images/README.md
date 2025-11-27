# 画像ディレクトリ

このディレクトリには、UserGuide.md および Glossary.md で使用されるスクリーンショットや図を配置します。

## 命名規則

管理しやすくするために、以下の命名規則を採用します:

- **エンティティベース**: エンティティ名（単数形） + アクション + .png
  - エンティティ: platform, stream, listener, status, gift, follower, participant
  - アクション: list, detail, add, edit, assign, log, management, badge, tags, history, graph, template
  - 例: `platform-list.png`, `listener-detail.png`, `status-assign.png`
- **一般画面**: `dashboard.png`, `menu.png`, `tab-navigation.png`
- **機能別**: 特定の機能に該当しないものは `feature-name.png`

## 現在の画像ファイル

以下の画像が配置されています（統一後のファイル名）:

### プラットフォーム関連
- `platform-list.png` - プラットフォーム一覧
- `platform-detail.png` - プラットフォーム詳細
- `platform-add.png` - プラットフォーム追加

### 配信関連
- `stream-list.png` - 配信一覧
- `stream-detail.png` - 配信詳細
- `stream-add.png` - 配信追加

### リスナー関連
- `listener-list.png` - リスナー一覧
- `listener-detail.png` - リスナー詳細
- `listener-add.png` - リスナー追加
- `listener-edit.png` - リスナー編集
- `listener-tags.png` - リスナータグ表示

### 参加者関連
- `participant-add.png` - 参加者追加

### ギフト関連
- `gift-add.png` - ギフト追加

### ステータス関連
- `status-management.png` - ステータス管理
- `status-detail.png` - ステータス詳細
- `status-badge.png` - ステータスバッジ表示
- `status-assign.png` - ステータス付与
- `status-log.png` - ステータス履歴
- `status-list.png` - ステータス一覧

### 登録者関連
- `follower-history.png` - 登録者推移
- `follower-history-graph.png` - 登録者推移グラフ

### 一般
- `dashboard.png` - ダッシュボード
- `menu.png` - メニュー画面

## 画像の要件

- **形式**: PNG形式を推奨
- **サイズ**: 幅800px程度が適切
- **内容**: 実際のアプリケーション画面のスクリーンショット
- **プライバシー**: 個人情報が含まれないようサンプルデータを使用

## スクリーンショットの撮り方

1. アプリケーションをブラウザで開く
2. 各機能画面を表示
3. ブラウザの開発者ツールやスクリーンショットツールで撮影
4. 必要に応じて注釈や矢印を追加
5. このディレクトリに配置

### 各画像の取得方法

- `dashboard.png`: アプリ起動直後のダッシュボード画面
- `platform-list.png`: 📺 プラットフォームタブからプラットフォーム一覧画面
- `platform-detail.png`: プラットフォーム一覧から任意のプラットフォームをクリック
- `platform-add.png`: プラットフォーム一覧の「＋ プラットフォームを追加」ボタンクリック
- `stream-list.png`: プラットフォーム詳細の「📺 配信一覧」タブ
- `stream-detail.png`: 配信一覧から任意の配信をクリック
- `stream-add.png`: 配信一覧の「＋ 配信を追加」ボタンクリック
- `listener-list.png`: 👤 リスナータブからリスナー一覧画面
- `listener-detail.png`: リスナー一覧から任意のリスナーをクリック
- `listener-add.png`: リスナー一覧の「＋ リスナーを追加」ボタンクリック
- `listener-edit.png`: リスナー詳細の「✏️ 編集」ボタンクリック
- `listener-tags.png`: リスナー詳細やリスナー追加画面のタグ入力部分
- `participant-add.png`: 配信詳細の「＋ 参加者を追加」ボタンクリック
- `gift-add.png`: 配信詳細の「＋ ギフトを追加」ボタンクリック
- `status-management.png`: 🏷️ ステータス管理タブ
- `status-detail.png`: ステータス管理画面で任意のステータスを選択
- `status-badge.png`: リスナー一覧や詳細のステータスバッジ表示部分
- `status-assign.png`: リスナー詳細の「現在のステータス」枠内「ステータスを管理」クリック
- `status-log.png`: リスナー詳細の「履歴を見る」クリック
- `status-list.png`: ステータス管理画面のフィルタを「全件」に変更
- `follower-history.png`: プラットフォーム詳細の「📈 登録者推移」タブ
- `follower-history-graph.png`: ダッシュボードの「登録者数の推移」セクション
- `menu.png`: ヘッダーの☰ボタンクリックでメニューを開く
- `tab-navigation.png`: 任意のページのヘッダー部分（タブナビゲーション）をスクリーンショット
