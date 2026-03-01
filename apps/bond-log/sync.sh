#!/bin/bash

# bond-log デプロイ用同期スクリプト
# ソースリポジトリから必要なファイルをこのディレクトリに複製します

# ソースディレクトリ（必要に応じて調整してください）
SOURCE_DIR="/home/com/ubuntu_dir/develop/github/bond-log"

# 現在のスクリプトがあるディレクトリ（デプロイ先）
DEST_DIR="$(cd "$(dirname "$0")" && pwd)"

# 色付き出力用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "bond-log ファイル同期スクリプト"
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
# ビルド成果物の鮮度チェック
# ===========================================
echo "--- ビルド成果物の鮮度チェック ---"

# ソースリポジトリの最終コミットの UNIX タイムスタンプを取得
LAST_COMMIT_TS=$(git -C "$SOURCE_DIR" log -1 --format='%ct')
LAST_COMMIT_DATE=$(git -C "$SOURCE_DIR" log -1 --format='%ci')

if [ -z "$LAST_COMMIT_TS" ]; then
  echo -e "${RED}エラー: ソースリポジトリの git 情報を取得できませんでした${NC}"
  exit 1
fi

echo "最終コミット: $LAST_COMMIT_DATE"
echo ""

# チェック対象の生成ファイル一覧
GENERATED_FILES=(
  "BondLog.html"
  "UserGuide.html"
  "Glossary.html"
)

# use-cases/ 内の HTML も対象に追加
if [ -d "$SOURCE_DIR/use-cases" ]; then
  while IFS= read -r -d '' f; do
    GENERATED_FILES+=("$f")
  done < <(find "$SOURCE_DIR/use-cases" -name '*.html' -type f -print0)
fi

STALE_FILES=()

for file in "${GENERATED_FILES[@]}"; do
  # フルパスかファイル名だけか判定
  if [[ "$file" == /* ]] || [[ "$file" == "$SOURCE_DIR"* ]]; then
    filepath="$file"
    display_name="${file#$SOURCE_DIR/}"
  else
    filepath="$SOURCE_DIR/$file"
    display_name="$file"
  fi

  if [ ! -f "$filepath" ]; then
    echo -e "${RED}✗${NC} $display_name が存在しません（ビルド未実行の可能性があります）"
    STALE_FILES+=("$display_name（未生成）")
  else
    FILE_TS=$(stat -c '%Y' "$filepath")
    if [ "$FILE_TS" -lt "$LAST_COMMIT_TS" ]; then
      FILE_DATE=$(stat -c '%y' "$filepath" | cut -d. -f1)
      echo -e "${YELLOW}!${NC} $display_name の更新時刻（$FILE_DATE）がコミットより古いです"
      STALE_FILES+=("$display_name")
    else
      echo -e "${GREEN}✓${NC} $display_name は最新です"
    fi
  fi
done

echo ""

if [ ${#STALE_FILES[@]} -gt 0 ]; then
  echo -e "${RED}=========================================="
  echo "エラー: 以下の生成ファイルが最終コミットより古い、"
  echo "または存在しません:"
  echo "==========================================${NC}"
  for sf in "${STALE_FILES[@]}"; do
    echo -e "  ${RED}•${NC} $sf"
  done
  echo ""
  echo "ソースリポジトリで以下を実行してから再度お試しください:"
  echo ""
  echo "  cd $SOURCE_DIR"
  echo "  devbox run build-docs            # HTML ドキュメント生成"
  echo "  devbox run go run build.go        # BondLog.html 生成"
  echo ""
  echo -e "${YELLOW}--force オプションで強制実行も可能です${NC}"

  # --force オプションが指定されている場合はスキップ
  if [[ "$1" == "--force" ]]; then
    echo ""
    echo -e "${YELLOW}--force が指定されたため、チェックをスキップして続行します${NC}"
  else
    exit 1
  fi
fi

echo "--- 鮮度チェック完了 ---"
echo ""

# ===========================================
# ファイル複製
# ===========================================

# 複製するファイルのリスト
FILES=(
  "index.html"
  "style.css"
  "UserGuide.html"
  "Glossary.html"
  "sample-data.json"
  "BondLog.html"
)

# 複製するディレクトリのリスト
DIRS=(
  "images"
  "app"
)

# 一部のファイルのみ複製するディレクトリのリスト
PARTIAL_DIRS=(
  "use-cases"
)

# 一部のファイルのみ複製するディレクトリごとのファイルタイプ
declare -A PARTIAL_FILE_TYPES
PARTIAL_FILE_TYPES["use-cases"]="*.html"

# ファイルのコピー
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

# ディレクトリのコピー
for dir in "${DIRS[@]}"; do
  if [ -d "$SOURCE_DIR/$dir" ]; then
    rm -rf "$DEST_DIR/$dir"
    cp -r "$SOURCE_DIR/$dir" "$DEST_DIR/$dir"
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✓${NC} $dir/ ディレクトリをコピーしました"
      SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
      echo -e "${RED}✗${NC} $dir/ ディレクトリのコピーに失敗しました"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    echo -e "${YELLOW}!${NC} $dir/ ディレクトリがソースに見つかりません"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# 一部のファイルのみ複製するディレクトリのコピー
for dir in "${PARTIAL_DIRS[@]}"; do
  pattern=${PARTIAL_FILE_TYPES[$dir]}
  if [ -d "$SOURCE_DIR/$dir" ]; then
    mkdir -p "$DEST_DIR/$dir"
    find "$SOURCE_DIR/$dir" -name "$pattern" -type f -exec cp {} "$DEST_DIR/$dir/" \;
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✓${NC} $dir/$pattern をコピーしました"
      SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
      echo -e "${RED}✗${NC} $dir/$pattern のコピーに失敗しました"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    echo -e "${YELLOW}!${NC} $dir/ ディレクトリがソースに見つかりません"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# ===========================================
# BondLog.zip の生成
# ===========================================
echo ""
echo "--- BondLog.zip の生成 ---"
if [ -f "$DEST_DIR/BondLog.html" ]; then
  rm -f "$DEST_DIR/BondLog.zip"
  # BondLog.html に加えてリンク先のファイルもまとめて ZIP 化
  ZIP_FILES=(
    "BondLog.html"
    "UserGuide.html"
    "Glossary.html"
    "sample-data.json"
  )
  # use-cases/ 内の HTML も含める
  ZIP_EXTRA_ARGS=()
  if [ -d "$DEST_DIR/use-cases" ]; then
    ZIP_EXTRA_ARGS+=("use-cases/")
  fi
  (cd "$DEST_DIR" && zip -q -r BondLog.zip "${ZIP_FILES[@]}" "${ZIP_EXTRA_ARGS[@]}")
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} BondLog.zip を生成しました（UserGuide.html, Glossary.html, sample-data.json, use-cases/ を含む）"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    # BondLog.html はデプロイ先では ZIP に含まれているため削除
    rm -f "$DEST_DIR/BondLog.html"
    echo -e "${GREEN}✓${NC} デプロイ先の BondLog.html を削除しました（ZIP に含まれているため）"
  else
    echo -e "${RED}✗${NC} BondLog.zip の生成に失敗しました"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  echo -e "${YELLOW}!${NC} BondLog.html が見つからないため BondLog.zip を生成できません"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "=========================================="
echo -e "完了: ${GREEN}$SUCCESS_COUNT${NC} 成功, ${RED}$FAIL_COUNT${NC} 失敗"
echo "=========================================="

if [ $FAIL_COUNT -eq 0 ]; then
  exit 0
else
  exit 1
fi