#!/bin/bash

DATE=$(date +%Y-%m-%d)
TITLE=$1

if [ -z "$TITLE" ]; then
  echo "使い方: $0 '記事タイトル（英数字とハイフンのみ）'"
  exit 1
fi

FILENAME="_posts/${DATE}-${TITLE}.md"

cp _templates/post_template.md "$FILENAME"
sed -i "s/記事タイトル/${TITLE}/g" "$FILENAME"
sed -i "s/2025-05-09/${DATE}/g" "$FILENAME"

echo "記事作成: $FILENAME"
