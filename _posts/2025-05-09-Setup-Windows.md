---
layout: post
title: "Setup Windows"
date: 2025-05-09
---

デスクトップPC で Windows 11 をクリーンインストールした際のメモ

## アカウント設定

- Microsoft アカウントで初期セットアップ
- 設定 > アカウント > 他のユーザー > アカウントの追加 > 「このユーザーのサインイン情報がありません」をクリック > 「Microsoft アカウントを持たないユーザーを追加する」をクリック > ローカルアカウントを追加
    - 追加後にアカウントの種類を「管理者」に変更
- 一度ログアウトし、追加したローカルアカウントでログイン
- 設定 > アカウント > 他のユーザー > Microsoft アカウントで作成したユーザを選択し「削除」
- PIN が未設定の場合は PIN でサインインできるよう変更
    - 設定 > アカウント > サインイン オプション で PIN を設定

## 設定変更

- フォルダーオプションの変更
    - 隠しファイル、隠しフォルダー、および隠しドライブを表示する
    - 登録されている拡張子は表示しない のチェックを外す
- 電源オプションの変更
    - 高パフォーマンス
    - ディスプレイの電源を切る は1時間に変更



## ソフトウェアインストール
- **PowerShell 7**
    - `https://aka.ms/PSWindows` にアクセスして最新版の PowerShell をインストール
- PowerShell で Winget を利用してインストール
    - [InstallSoftware.ps1](https://gist.github.com/kkryama/76ad6b9428dd0bcfea91016c28a4a708) を任意の場所に置く
        - `C:\Users\<ユーザー名>\Documents\Automation\InstallSoftware.ps1` など
    - PowerShell を管理者として実行
    - `.\InstallSoftware.ps1` で実行してインストールする
- その他、個別に入れるものを入れていく

