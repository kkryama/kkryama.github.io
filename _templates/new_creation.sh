#!/bin/bash

DATE=$(date +%Y-%m-%d)
TITLE=$1

if [ -z "$TITLE" ]; then
  echo "使い方: $0 '作品タイトル（英数字とハイフンのみ）'"
  exit 1
fi

FILENAME="_creation/${DATE}-${TITLE}.md"

cp _templates/creation_template.md "$FILENAME"
sed -i "s/作品タイトル/${TITLE}/g" "$FILENAME"
sed -i "s/2025-05-09/${DATE}/g" "$FILENAME"

echo "Creation記事作成: $FILENAME"