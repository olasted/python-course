"""
Copies the course content from src/ into docs/, the static, browser-only
build that GitHub Pages serves. Run this after editing anything under
src/curriculum/ or src/static/css, or src/img.

    python tools/build_static.py

It does NOT touch docs/index.html, docs/static/js/main.js or
docs/static/js/pyworker.js — those are the browser-only app itself and are
maintained by hand, separately from the Flask app in src/.
"""
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC  = os.path.join(ROOT, 'src')
DOCS = os.path.join(ROOT, 'docs')

DAYS_SRC = os.path.join(SRC, 'curriculum', 'days')
DAYS_DST = os.path.join(DOCS, 'data', 'days')


def copy_days_and_manifest():
    os.makedirs(DAYS_DST, exist_ok=True)
    manifest = []
    for filename in sorted(os.listdir(DAYS_SRC)):
        if not (filename.startswith('day_') and filename.endswith('.json')):
            continue
        src_path = os.path.join(DAYS_SRC, filename)
        with open(src_path, encoding='utf-8') as f:
            data = json.load(f)
        shutil.copyfile(src_path, os.path.join(DAYS_DST, filename))
        manifest.append({
            'day': data['day'],
            'title': data['title'],
            'total': len(data.get('tasks', [])),
        })
    manifest.sort(key=lambda d: d['day'])
    with open(os.path.join(DOCS, 'data', 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    return manifest


def copy_file(src_rel, dst_rel):
    src_path = os.path.join(SRC, src_rel)
    dst_path = os.path.join(DOCS, dst_rel)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    shutil.copyfile(src_path, dst_path)


def main():
    os.makedirs(os.path.join(DOCS, 'data'), exist_ok=True)

    manifest = copy_days_and_manifest()
    copy_file(os.path.join('curriculum', 'reference.json'), os.path.join('data', 'reference.json'))
    copy_file(os.path.join('curriculum', 'error_helper.py'), os.path.join('static', 'js', 'py_error_helper.py'))
    copy_file(os.path.join('static', 'css', 'style.css'), os.path.join('static', 'css', 'style.css'))
    copy_file(os.path.join('img', 'py_logo.png'), os.path.join('img', 'py_logo.png'))

    total_tasks = sum(d['total'] for d in manifest)
    print(f'Copied {len(manifest)} days ({total_tasks} tasks), reference.json, error_helper.py, style.css, py_logo.png')
    print('docs/ is up to date.')


if __name__ == '__main__':
    main()
