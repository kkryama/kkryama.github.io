# My Jekyll Site

このリポジトリは [GitHub Pages](https://kkryama.github.io/) を利用して公開する Jekyll サイトです。
技術記事と日記を分けて管理し、それぞれの記事一覧も用意しています。

---

# ディレクトリ構成

```
├── README.md             # このファイル
├── .gitignore            # Git管理除外設定
├── index.md              # ホームページ
├── profile.md            # プロフィールページ
├── _config.yml           # Jekyll 設定ファイル
├── Gemfile               # 必要な gem を記述
├── Gemfile.lock          # gem のバージョン管理
├── build.sh              # ビルドスクリプト（最終更新日自動更新とJekyllビルド）
├── _layouts/             # カスタムレイアウトファイル
│   └── post.html             # 投稿用レイアウト
├── _posts/               # 技術記事 (YYYY-MM-DD-title.md)
├── _diary/               # 日記記事 (YYYY-MM-DD.md)
├── _creation/            # 創作記事 (YYYY-MM-DD-title.md)
├── _templates/           # テンプレートと記事作成スクリプト
│   ├── post_template.md      # 技術記事用テンプレート
│   ├── diary_template.md     # 日記用テンプレート
│   ├── creation_template.md  # 創作記事用テンプレート
│   ├── new_post.sh           # 技術記事作成用スクリプト
│   ├── new_diary.sh          # 日記作成用スクリプト
│   └── new_creation.sh       # 創作記事作成用スクリプト
├── scripts/              # ビルド用スクリプト
│   └── update_modified_dates.py  # 最終更新日自動更新スクリプト
├── posts.html            # 技術記事一覧ページ
├── diary.html            # 日記一覧ページ
├── creation.html         # 創作記事一覧ページ
├── assets/               # 画像などの静的ファイル
│   └── images/               # 画像ファイル
├── _site/                # ビルドされたサイト (Git 管理対象外)
├── .sass-cache/          # Sassキャッシュ (Git 管理対象外)
├── .bundle/              # Bundlerキャッシュ (Git 管理対象外)
└── vendor/               # ローカルの gem インストール先 (Git 管理対象外)
```


---

# ローカル環境セットアップ

## 必要パッケージのインストール (Ubuntu)

```bash
sudo apt update
sudo apt install ruby-full build-essential zlib1g-dev
```

## GEM_HOME 環境変数の設定

```bash
echo 'export GEM_HOME="$HOME/.gem"' >> ~/.bashrc
echo 'export PATH="$HOME/.gem/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## bundler と jekyll のインストール

```bash
gem install bundler jekyll
```

## 依存関係のインストール

```bash
bundle install --path vendor/bundle
```

## ローカルでの動作確認

```bash
bundle exec jekyll serve
```

ブラウザで http://127.0.0.1:4000 を開く。

## サイトのビルド

最終更新日を自動更新してからJekyllサイトをビルドするには：

```bash
./build.sh
```

このスクリプトは以下の処理を行います：
1. 修正されているが未コミットのファイルを特定
2. Git履歴から各記事の最終更新日時を取得（ISO形式: YYYY-MM-DD HH:MM:SS +TIMEZONE）
3. 対象ファイルのfront matterに `last_modified_at` フィールドを自動追加/更新（コミット済みファイルは処理しない）
4. Jekyllサイトをビルド

### 最終更新日の表示

- **記事ページ**: 投稿日と最終更新日時（時刻含む）を表示
- **一覧ページ**: 最終更新日が投稿日と異なる場合のみ、最終更新日時を小さく表示
- カスタムレイアウト（`_layouts/post.html`）により、Jekyll標準テーマを拡張して表示

---

# 記事の追加方法

## テンプレートと記事作成スクリプトについて

このリポジトリには、記事作成用のテンプレートとスクリプトが用意されています。

### テンプレートの場所

- _templates/creation_template.md … 創作記事用テンプレート
- _templates/diary_template.md … 日記用テンプレート
- _templates/post_template.md … 技術記事用テンプレート


### スクリプトの使い方

記事を新しく作成する場合は、以下のコマンドを実行してください。

#### 技術記事を作成する場合

```bash
./_templates/new_post.sh 記事タイトル（英数字とハイフンのみ）
```

例：

```bash
./_templates/new_post.sh my-new-article
```

実行すると `_posts/YYYY-MM-DD-my-new-article.md` が作成され、テンプレートが適用されます。

#### 創作記事を作成する場合

```bash
./_templates/new_creation.sh 記事タイトル（英数字とハイフンのみ）
```

例：

```bash
./_templates/new_creation.sh my-creation-title
```

実行すると `_creation/YYYY-MM-DD-my-creation-title.md` が作成され、テンプレートが適用されます。

#### 日記を作成する場合

```bash
./_templates/new_diary.sh
```

実行すると _diary/YYYY-MM-DD.md が作成され、テンプレートが適用されます。

### 注意事項

- スクリプトを初めて使う場合は、実行権限を付与してください。（初回のみ）

```bash
chmod +x _templates/new_diary.sh
chmod +x _templates/new_creation.sh
chmod +x _templates/new_post.sh
```

- 日記のファイル名は日付のみ、技術記事および創作記事のファイル名は YYYY-MM-DD-タイトル.md 形式で作成されます。
- タイトルは英数字とハイフンのみを推奨します。

## テンプレートによらない記事の追加

### 技術記事の追加
`_posts/` に以下の形式でファイルを追加。

ファイル名: YYYY-MM-DD-title.md

```
---
layout: post
title: "記事タイトル"
date: YYYY-MM-DD
last_modified_at: YYYY-MM-DD HH:MM:SS +TIMEZONE  # ビルド時に自動更新されます
---

記事の本文
```

### 創作記事の追加
`_creation/` に以下の形式でファイルを追加。

ファイル名: YYYY-MM-DD-title.md

```
---
layout: post
title: "記事タイトル"
date: YYYY-MM-DD
last_modified_at: YYYY-MM-DD HH:MM:SS +TIMEZONE  # ビルド時に自動更新されます
---

記事の本文
```

### 日記記事の追加
`_diary/` に以下の形式でファイルを追加。

ファイル名: YYYY-MM-DD.md

```
---
layout: post
title: "日記タイトル"
date: YYYY-MM-DD
last_modified_at: YYYY-MM-DD HH:MM:SS +TIMEZONE  # ビルド時に自動更新されます
---

日記の本文
```



# その他

## ページ構成
- `index.md`: ホームページ
- `profile.md`: プロフィールページ
- `posts.html`: 技術記事一覧ページ
- `diary.html`: 日記一覧ページ
- `creation.html`: 創作記事一覧ページ

## レイアウト
- `_layouts/post.html`: 投稿用カスタムレイアウト
    - 投稿日と最終更新日時を表示
    - 最終更新日が投稿日と異なる場合のみ最終更新日を表示

## Jekyll設定
- `_config.yml`: Jekyll サイト設定
    - コレクションとして creation, diary を設定済み
    - permalinkパターン: `/:year/:month/:day/:title/`
    - テーマ: `jekyll-theme-primer`

## 静的ファイル
- `assets/images/`: 画像ファイル保存用
    - `common/`: 共通画像
    - `creation/`: 創作記事用画像
    - `diary/`: 日記用画像
    - `posts/`: 技術記事用画像

## Git管理除外設定
- `_site/`: Jekyllビルド出力
- `vendor/`: bundlerローカルインストール
- `.sass-cache/`: Sassキャッシュ
- `.bundle/`: bundlerキャッシュ
- IDEファイル、一時ファイル等

## コミットメッセージ規約

このプロジェクトでは [Conventional Commits](https://www.conventionalcommits.org/) を参考にコミットメッセージを記述します。

### 基本フォーマット

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### 主なタイプ

- `feat`: 新しい機能の追加
- `fix`: バグ修正
- `docs`: ドキュメントのみの変更
- `style`: コードの意味に影響を与えない変更（空白、フォーマット、セミコロンの欠落など）
- `refactor`: バグ修正でも機能追加でもないコード変更
- `test`: テストの追加や既存のテストの修正
- `chore`: ビルドプロセスやツール、ライブラリの変更

### 例

```bash
feat: 新しい技術記事テンプレートを追加
fix: 日記一覧ページのレイアウト修正
docs: README にコミット規約を追加
chore: Jekyll の設定を更新
```

### 記事関連のコミット例

```bash
feat: Setup Windowsの記事を追加
feat: 日記テンプレート作成スクリプトを追加
docs: プロフィールページを更新
fix: 記事一覧ページのソート順を修正
```

### Copilotでのコミットメッセージ生成

作業完了後、以下のプロンプトでCopilotにコミットメッセージを作成してもらえます：

```
ここまでの作業内容をgit addしています。
Conventional Commitsの規約に従って、日本語で変更点を要約したコミットメッセージを作成してください。
```

#### より詳細な指示例

```
以下の変更をgit addしています：
- [変更内容の説明]

Conventional Commitsの規約に従って、以下の形式でコミットメッセージを作成してください：
1. type: 適切なタイプ（feat, fix, docs等）を選択
2. description: 日本語で簡潔に変更内容を要約
3. body（必要に応じて）: 変更の理由や詳細説明
```
