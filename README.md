# My Jekyll Site

このリポジトリは [GitHub Pages](https://kkryama.github.io/) を利用して公開する Jekyll サイトです。
技術記事と日記を分けて管理し、それぞれの記事一覧も用意しています。

---

## ディレクトリ構成

```
├── README.md             # このファイル
├── index.md              # 自己紹介ページ
├── about.md              # プロフィールページ
├── _config.yml           # Jekyll 設定ファイル
├── Gemfile               # 必要な gem を記述
├── Gemfile.lock          # gem のバージョン管理
├── _posts/               # 技術記事 (YYYY-MM-DD-title.md)
├── _diary/               # 日記記事 (YYYY-MM-DD.md)
├── diary.html            # 日記一覧ページ
├── posts.html            # 技術記事一覧ページ
├── _site/                # ビルドされたサイト (Git 管理対象外)
├── vendor/               # ローカルの gem インストール先 (Git 管理対象外)
```


---

## ローカル環境セットアップ

### 必要パッケージのインストール (Ubuntu)

```bash
sudo apt update
sudo apt install ruby-full build-essential zlib1g-dev
```

### GEM_HOME 環境変数の設定

```
echo 'export GEM_HOME="$HOME/.gem"' >> ~/.bashrc
echo 'export PATH="$HOME/.gem/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### bundler と jekyll のインストール

```
gem install bundler jekyll
```

### 依存関係のインストール

```
bundle install --path vendor/bundle
```

## ローカルでの動作確認

```
bundle exec jekyll serve
```

ブラウザで http://localhost:4000 を開く。

---

## 記事の追加方法

### 技術記事の追加
`_posts/` に以下の形式でファイルを追加。

ファイル名: YYYY-MM-DD-title.md

```
---
layout: post
title: "記事タイトル"
date: YYYY-MM-DD
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
---

日記の本文
```

## その他

- `diary.html`: 日記記事の一覧ページ

- `_config.yml`: Jekyll サイト設定
    - コレクションとして diary を設定済み
