import os
import re

directories = [
    r"d:\apps\차량운행일지\src\components\admin",
    r"d:\apps\차량운행일지\src\components\superAdmin"
]

def add_dark_mode(match):
    full_tag = match.group(0)
    class_attr_match = re.search(r'className=["\']([^"\']*)["\']', full_tag)
    
    if not class_attr_match:
        return full_tag
        
    class_name = class_attr_match.group(1)
    
    # 클래스를 공백 기준으로 분리
    classes = class_name.split()
    new_classes = classes.copy()
    
    # 매핑 룰
    rules = {
        'bg-white': 'dark:bg-surface-800',
        'bg-gray-50': 'dark:bg-surface-900',
        'bg-gray-100': 'dark:bg-surface-800',
        'bg-surface-50': 'dark:bg-surface-900',
        'bg-surface-100': 'dark:bg-surface-800',
        
        'text-gray-900': 'dark:text-surface-100',
        'text-gray-800': 'dark:text-surface-200',
        'text-gray-700': 'dark:text-surface-300',
        'text-gray-600': 'dark:text-surface-400',
        'text-gray-500': 'dark:text-surface-500',
        
        'text-surface-900': 'dark:text-surface-100',
        'text-surface-800': 'dark:text-surface-200',
        'text-surface-700': 'dark:text-surface-300',
        'text-surface-600': 'dark:text-surface-400',
        
        'border-gray-200': 'dark:border-surface-700',
        'border-gray-300': 'dark:border-surface-600',
        'border-surface-200': 'dark:border-surface-700',
        'border-surface-300': 'dark:border-surface-600',
    }
    
    changed = False
    for c in classes:
        if c in rules:
            dark_class = rules[c]
            # dark: 짝이 없는지 확인
            has_dark_counterpart = any(d.startswith('dark:') and (
                ('bg-' in c and 'bg-' in d) or 
                ('text-' in c and 'text-' in d) or 
                ('border-' in c and 'border-' in d)
            ) for d in classes)
            
            if not has_dark_counterpart and dark_class not in new_classes:
                new_classes.append(dark_class)
                changed = True
                
    if changed:
        new_class_name = " ".join(new_classes)
        return full_tag.replace(f'className="{class_name}"', f'className="{new_class_name}"')
    
    return full_tag

changed_files = 0

for directory in directories:
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".tsx"):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # <... className="..." ... > 패턴
                # 태그 단위로 잡는게 안전함
                new_content = re.sub(r'<[a-zA-Z0-9_]+\b[^>]*className=["\'][^"\']*["\'][^>]*>', add_dark_mode, content)
                
                if content != new_content:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated dark mode: {filepath}")
                    changed_files += 1

print(f"Total files updated for dark mode: {changed_files}")
