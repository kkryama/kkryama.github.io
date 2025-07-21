#!/bin/bash

echo "Updating last modified dates..."
python3 scripts/update_modified_dates.py

echo "Building Jekyll site..."
bundle exec jekyll build

echo "Build complete!"
