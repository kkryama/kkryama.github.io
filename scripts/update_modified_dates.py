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

def is_file_modified(file_path):
    """ファイルが修正されているが未コミットかどうかを確認"""
    try:
        # git status --porcelain でファイルの状態を確認
        result = subprocess.run([
            'git', 'status', '--porcelain', '--', str(file_path)
        ], capture_output=True, text=True, check=True)
        
        status = result.stdout.strip()
        if status:
            # ファイルが修正されている (M) または追加されている (A) 場合
            status_code = status[:2]
            return 'M' in status_code or 'A' in status_code
        return False
    except subprocess.CalledProcessError:
        return False

def get_current_last_modified_at(file_path):
    """現在のfront matterからlast_modified_atを取得"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        front_matter_pattern = r'^---\n(.*?)\n---\n(.*)$'
        match = re.match(front_matter_pattern, content, re.DOTALL)
        
        if not match:
            return None
        
        front_matter = match.group(1)
        
        # last_modified_atの値を取得
        modified_match = re.search(r'^last_modified_at:\s*(.+)$', front_matter, re.MULTILINE)
        if modified_match:
            return modified_match.group(1).strip()
        
        return None
    except Exception:
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
            # ファイルが修正されているかチェック
            if not is_file_modified(md_file):
                print(f"  Skipping {md_file.name} (no changes)")
                continue
            
            last_modified = get_last_modified_date(md_file)
            current_last_modified = get_current_last_modified_at(md_file)
            
            if last_modified:
                # 既存のlast_modified_atと比較して、異なる場合のみ更新
                if current_last_modified != last_modified:
                    if update_front_matter(md_file, last_modified):
                        print(f"  Updated {md_file.name} with last_modified_at: {last_modified}")
                else:
                    print(f"  Skipping {md_file.name} (last_modified_at already up to date)")
            else:
                print(f"  Warning: Could not get last modified date for {md_file.name}")

if __name__ == '__main__':
    main()
