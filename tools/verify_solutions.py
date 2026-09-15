"""
Runs every worked solution in the curriculum and checks it still produces the
expected output. Useful after editing a day file.

    python tools/verify_solutions.py          # all days
    python tools/verify_solutions.py 5 12     # just days 5 and 12
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(os.path.dirname(HERE), 'src')
DAYS = os.path.join(SRC, 'curriculum', 'days')

sys.path.insert(0, SRC)
from curriculum.code_runner import CodeRunner  # noqa: E402


def main():
    wanted = {int(a) for a in sys.argv[1:]}
    runner = CodeRunner(os.path.join(HERE, '.verify_workspace'))

    ok = problems = skipped = 0
    for path in sorted(glob.glob(os.path.join(DAYS, 'day_*.json'))):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        day = data['day']
        if wanted and day not in wanted:
            continue

        for task in data['tasks']:
            code = task.get('solution')
            if not code:
                print(f"  {task['id']}: no solution")
                problems += 1
                continue
            if task.get('solution_requires'):
                skipped += 1
                continue

            result = runner.run(code + '\n', task.get('solution_stdin', ''), timeout=15)
            if result['error']:
                last = result['error'].strip().splitlines()[-1]
                print(f"  {task['id']}: ERROR {last[:100]}")
                problems += 1
            elif task['expected'] and result['output'].strip() != task['expected'].strip():
                print(f"  {task['id']}: MISMATCH")
                print(f"      expected {task['expected']!r}")
                print(f"      got      {result['output']!r}")
                problems += 1
            else:
                ok += 1
        print(f'day {day:02d} checked')

    print(f'\n{ok} solutions verified, {skipped} skipped (need network), {problems} problems')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
