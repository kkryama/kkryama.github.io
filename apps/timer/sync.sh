#!/bin/bash

# timer デプロイ用同期スクリプト
# ソースリポジトリから必要なファイルをこのディレクトリに複製します

# ソースディレクトリ（必要に応じて調整してください）
SOURCE_DIR="/home/com/ubuntu_dir/develop/nongit/timer"

# 現在のスクリプトがあるディレクトリ（デプロイ先）
DEST_DIR="$(cd "$(dirname "$0")" && pwd)"

# 色付き出力用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "timer ファイル同期スクリプト"
echo "=========================================="
echo "ソース: $SOURCE_DIR"
echo "デプロイ先: $DEST_DIR"
echo ""

# ソースディレクトリの存在確認
if [ ! -d "$SOURCE_DIR" ]; then
  echo -e "${RED}エラー: ソースディレクトリが見つかりません: $SOURCE_DIR${NC}"
  exit 1
fi

# ===========================================
# ファイル複製
# ===========================================

# 複製するファイルのリスト
FILES=(
  "index.html"
  "timer.html"
  "beep.wav"
  "timer.zip"
)

SUCCESS_COUNT=0
FAIL_COUNT=0

for file in "${FILES[@]}"; do
  if [ -f "$SOURCE_DIR/$file" ]; then
    cp "$SOURCE_DIR/$file" "$DEST_DIR/$file"
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✓${NC} $file をコピーしました"
      SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
      echo -e "${RED}✗${NC} $file のコピーに失敗しました"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    echo -e "${YELLOW}!${NC} $file がソースに見つかりません"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo ""
echo "=========================================="
echo -e "完了: ${GREEN}$SUCCESS_COUNT${NC} 成功, ${RED}$FAIL_COUNT${NC} 失敗"
echo "=========================================="

if [ $FAIL_COUNT -eq 0 ]; then
  exit 0
else
  exit 1
fi
