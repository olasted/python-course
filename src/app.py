import os
import json
from flask import Flask, render_template, request, jsonify, send_from_directory

from curriculum.task_loader import TaskLoader
from curriculum.progress_manager import ProgressManager
from curriculum.code_runner import CodeRunner
from curriculum.focus_manager import enable_focus, disable_focus, is_focus_active, is_admin as focus_is_admin

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-key-change-in-production'

_here = os.path.dirname(os.path.abspath(__file__))

task_loader      = TaskLoader(os.path.join(_here, 'curriculum', 'days'))
progress_manager = ProgressManager(os.path.join(_here, 'progress.json'))
code_runner      = CodeRunner(os.path.join(_here, 'workspace'))

_TOTAL_TASKS: int = task_loader.preload_all()

_REFERENCE_PATH = os.path.join(_here, 'curriculum', 'reference.json')


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/img/<path:filename>')
def serve_img(filename):
    return send_from_directory(os.path.join(_here, 'img'), filename)


@app.route('/api/days')
def get_available_days():
    resp = jsonify(task_loader.get_available_days())
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@app.route('/api/day/<int:day>')
def get_day(day):
    tasks = task_loader.load_day(day)
    if 'error' in tasks:
        return jsonify(tasks), 404

    progress = progress_manager.get_day_progress(day)
    result = dict(tasks)
    result['tasks'] = [
        {**t, 'status': progress.get(t['id'], 'not_started')}
        for t in tasks['tasks']
    ]
    return jsonify(result)


@app.route('/api/overview')
def get_overview():
    """Every day with its title and how many of its tasks are done."""
    done = progress_manager.completed_ids()
    days = []
    for day in task_loader.get_available_days():
        data = task_loader.load_day(day)
        ids  = [t['id'] for t in data.get('tasks', [])]
        days.append({
            'day':       day,
            'title':     data.get('title', ''),
            'total':     len(ids),
            'completed': sum(1 for i in ids if i in done),
        })
    return jsonify({'days': days, 'stats': progress_manager.get_stats(total_tasks=_TOTAL_TASKS)})


@app.route('/api/reference')
def get_reference():
    try:
        with open(_REFERENCE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {'sections': []}
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@app.route('/api/run', methods=['POST'])
def run_code():
    data        = request.json or {}
    code        = data.get('code', '')
    stdin_input = data.get('stdin', '')
    expected    = data.get('expected', '')

    result = code_runner.run(code, stdin_input)

    passed = bool(
        expected
        and not result['error']
        and result['output'].strip() == expected.strip()
    )

    return jsonify({
        'output':     result['output'],
        'error':      result['error'],
        'error_info': result['error_info'],
        'notes':      result['notes'],
        'passed':     passed,
    })


@app.route('/api/progress', methods=['POST'])
def update_progress():
    data    = request.json or {}
    task_id = data['task_id']
    status  = data['status']
    progress_manager.update_task_status(task_id, status)

    stats = progress_manager.get_stats(total_tasks=_TOTAL_TASKS)
    return jsonify({'success': True, 'stats': stats})


@app.route('/api/progress/stats')
def get_progress_stats():
    stats = progress_manager.get_stats(total_tasks=_TOTAL_TASKS)
    return jsonify(stats)


@app.route('/api/reset', methods=['POST'])
def reset_progress():
    progress_manager.reset()
    return jsonify({'success': True})


@app.route('/api/focus')
def get_focus_status():
    return jsonify({'active': is_focus_active(), 'can_toggle': focus_is_admin()})


@app.route('/api/focus/enable', methods=['POST'])
def focus_enable():
    return jsonify(enable_focus())


@app.route('/api/focus/disable', methods=['POST'])
def focus_disable():
    return jsonify(disable_focus())


if __name__ == '__main__':
    app.run(debug=True, port=5000)
