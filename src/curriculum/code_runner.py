import os
import sys
import tempfile
import subprocess

from .error_helper import explain


class CodeRunner:
    """
    Runs learner code in a separate Python process.

    Scripts execute inside `workspace_dir`, so any files the learner creates
    with open(..., 'w') land there and can be read back on the next run.
    """

    def __init__(self, workspace_dir: str):
        self.python_cmd    = sys.executable
        self.workspace_dir = workspace_dir
        os.makedirs(self.workspace_dir, exist_ok=True)

    def run(self, code: str, stdin_input: str = '', timeout: int = 10) -> dict:
        temp_path = None
        error_info = None
        notes = ''
        try:
            with tempfile.NamedTemporaryFile(
                mode='w', suffix='.py', prefix='run_', delete=False,
                encoding='utf-8', dir=self.workspace_dir,
            ) as f:
                f.write(code)
                temp_path = f.name

            env = dict(os.environ)
            env['PYTHONIOENCODING'] = 'utf-8'
            env['PYTHONUTF8'] = '1'

            result = subprocess.run(
                [self.python_cmd, temp_path],
                input=stdin_input,
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=timeout,
                cwd=self.workspace_dir,
                env=env,
            )

            output = result.stdout.strip()
            stderr = result.stderr or ''

            if result.returncode != 0:
                error = stderr.strip() or f'Process exited with code {result.returncode}'
                error_info = explain(error, temp_path)
            else:
                error = None
                # Warnings and the logging module write to stderr without failing.
                notes = stderr.strip()
                if temp_path:
                    notes = notes.replace(temp_path, 'your code')
        except subprocess.TimeoutExpired:
            output = ''
            error = f'Execution timed out ({timeout}s limit)'
            error_info = explain(error, temp_path)
        except Exception as e:
            output = ''
            error = str(e)
            error_info = explain(error, temp_path)
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

        if error and temp_path:
            error = error.replace(temp_path, 'your code')

        return {'output': output, 'error': error, 'error_info': error_info, 'notes': notes}
