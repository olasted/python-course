import json
import os
import queue
import threading
from datetime import date, timedelta


class ProgressManager:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self._write_queue: queue.Queue[str] = queue.Queue()
        self.data = self._load()
        threading.Thread(target=self._write_loop, daemon=True, name='progress-writer').start()

    def _load(self) -> dict:
        default = {'user': 'learner', 'tasks': {}, 'streak': 0, 'last_active': None}
        if not os.path.exists(self.filepath):
            return default
        try:
            with open(self.filepath, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
            for key, value in default.items():
                loaded.setdefault(key, value)
            return loaded
        except Exception:
            return default

    def _write_loop(self) -> None:
        while True:
            snapshot = self._write_queue.get()
            try:
                with open(self.filepath, 'w', encoding='utf-8') as f:
                    f.write(snapshot)
            except Exception:
                pass

    def _save(self) -> None:
        self._write_queue.put(json.dumps(self.data, indent=2))

    def update_task_status(self, task_id: str, status: str) -> None:
        self.data['tasks'][task_id] = status
        if status == 'completed':
            today = date.today().isoformat()
            last = self.data.get('last_active')
            if last != today:
                self.data['streak'] = (
                    self.data['streak'] + 1
                    if last == self._yesterday()
                    else 1
                )
                self.data['last_active'] = today
        self._save()

    def get_day_progress(self, day: int) -> dict:
        prefix = f'{day}.'
        return {k: v for k, v in self.data['tasks'].items() if k.startswith(prefix)}

    def completed_ids(self) -> set[str]:
        return {k for k, v in self.data['tasks'].items() if v == 'completed'}

    def get_stats(self, total_tasks: int | None = None) -> dict:
        tasks = self.data['tasks']
        completed = sum(1 for v in tasks.values() if v == 'completed')
        total = total_tasks if total_tasks is not None else len(tasks)
        percentage = round(completed / total * 100, 1) if total > 0 else 0.0

        # A streak only counts if it's still alive (today or yesterday).
        last = self.data.get('last_active')
        streak = self.data['streak'] if last in (date.today().isoformat(), self._yesterday()) else 0

        return {
            'completed': completed,
            'total': total,
            'percentage': percentage,
            'streak': streak,
            'last_active': last,
        }

    def reset(self) -> None:
        self.data = {'user': 'learner', 'tasks': {}, 'streak': 0, 'last_active': None}
        self._save()

    @staticmethod
    def _yesterday() -> str:
        return (date.today() - timedelta(days=1)).isoformat()
