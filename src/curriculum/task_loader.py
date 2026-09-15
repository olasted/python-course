import json
import os


class TaskLoader:
    def __init__(self, tasks_dir):
        self.tasks_dir = tasks_dir
        self._days_cache: list | None = None
        self._day_cache: dict = {}

    def get_available_days(self) -> list[int]:
        if self._days_cache is not None:
            return self._days_cache

        days = []
        if not os.path.exists(self.tasks_dir):
            return days

        for filename in os.listdir(self.tasks_dir):
            if filename.startswith('day_') and filename.endswith('.json'):
                try:
                    day_num = int(filename[4:7])
                    days.append(day_num)
                except ValueError:
                    pass

        self._days_cache = sorted(days)
        return self._days_cache

    def load_day(self, day: int) -> dict:
        if day in self._day_cache:
            return self._day_cache[day]

        filepath = os.path.join(self.tasks_dir, f'day_{day:03d}.json')
        if not os.path.exists(filepath):
            return {'error': f'Day {day} not found'}

        with open(filepath, 'r', encoding='utf-8') as f:
            result = json.load(f)

        self._day_cache[day] = result
        return result

    def preload_all(self) -> int:
        total = 0
        for day in self.get_available_days():
            data = self.load_day(day)
            total += len(data.get('tasks', []))
        return total
