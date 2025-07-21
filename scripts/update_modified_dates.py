#!/usr/bin/env python3
import os
import re
import subprocess
from pathlib import Path

def get_last_modified_date(file_path):
    """Gitから指定ファイルの最終更新日時を取得"""
    try:
        result = subprocess.run([
            'git', 'log', '-1', '--format=%ad', '--date=iso', '--', str(file_path)
        ], capture_output=True, text=True, check=True)
        datetime_str = result.stdout.strip()
        if datetime_str:
            return datetime_str
        else:
            return None
    except subprocess.CalledProcessError:
        return None

def update_front_matter(file_path, last_modified):
    """front matterのlast_modified_atを更新"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # front matterの範囲を特定
    front_matter_pattern = r'^---\n(.*?)\n---\n(.*)$'
    match = re.match(front_matter_pattern, content, re.DOTALL)
    
    if not match:
        print(f"Warning: No front matter found in {file_path}")
        return False
    
    front_matter, body = match.groups()
    
    # last_modified_atの更新または追加
    if re.search(r'^last_modified_at:', front_matter, re.MULTILINE):
        # 既存を更新
        front_matter = re.sub(
            r'^last_modified_at:.*$', 
            f'last_modified_at: {last_modified}', 
            front_matter, 
            flags=re.MULTILINE
        )
    else:
        # 新規追加
        front_matter += f'\nlast_modified_at: {last_modified}'
    
    # ファイルを書き戻し
    new_content = f'---\n{front_matter}\n---\n{body}'
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    return True

def main():
    # 処理対象のディレクトリ
    target_dirs = ['_posts', '_diary', '_creation']
    
    for dir_name in target_dirs:
        posts_dir = Path(dir_name)
        
        if not posts_dir.exists():
            print(f"Info: {dir_name} directory not found, skipping...")
            continue
        
        print(f"Processing {dir_name} directory...")
        
        for md_file in posts_dir.glob('*.md'):
            last_modified = get_last_modified_date(md_file)
            
            if last_modified:
                if update_front_matter(md_file, last_modified):
                    print(f"  Updated {md_file.name} with last_modified_at: {last_modified}")
            else:
                print(f"  Warning: Could not get last modified date for {md_file.name}")

if __name__ == '__main__':
    main()
