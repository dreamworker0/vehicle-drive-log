import os
import re

directories = [
    r"d:\apps\차량운행일지\src\components\admin",
    r"d:\apps\차량운행일지\src\components\superAdmin"
]

def add_min_h_48(match):
    full_tag = match.group(0)
    class_attr_match = re.search(r'className=["\']([^"\']*)["\']', full_tag)
    
    if not class_attr_match:
        # className이 없는 경우
        return full_tag
        
    class_name = class_attr_match.group(1)
    
    # 이미 48px 관련 클래스가 있으면 무시
    if 'min-h-[48px]' in class_name or 'p-3' in class_name or 'p-4' in class_name or 'py-3' in class_name or 'py-4' in class_name or 'h-12' in class_name or 'h-14' in class_name or 'h-16' in class_name:
        return full_tag
        
    new_class_name = class_name + " min-h-[48px]"
    
    # className="... min-h-[48px]" 로 치환
    new_tag = full_tag.replace(f'className="{class_name}"', f'className="{new_class_name}"')
    if new_tag == full_tag:
        new_tag = full_tag.replace(f"className='{class_name}'", f"className='{new_class_name}'")
        
    return new_tag

changed_files = 0

for directory in directories:
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".tsx"):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # <button ... className="..." ... > 패턴
                # re.sub(pattern, repl, string)
                
                # button
                new_content = re.sub(r'<button\b[^>]*className=["\'][^"\']*["\'][^>]*>', add_min_h_48, content)
                # input
                new_content = re.sub(r'<input\b[^>]*className=["\'][^"\']*["\'][^>]*>', add_min_h_48, new_content)
                # select
                new_content = re.sub(r'<select\b[^>]*className=["\'][^"\']*["\'][^>]*>', add_min_h_48, new_content)
                
                if content != new_content:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated: {filepath}")
                    changed_files += 1

print(f"Total files updated: {changed_files}")
