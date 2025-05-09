#!/bin/bash

DATE=$(date +%Y-%m-%d)

FILENAME="_diary/${DATE}.md"

cp _templates/diary_template.md "$FILENAME"
sed -i "s/2025-05-09/${DATE}/g" "$FILENAME"

echo "日記作成: $FILENAME"
