import subprocess
import sys
if sys.platform == 'win32':
    import wexpect as pexpect
else:
    import pexpect

class TerminalRunner:
    def __init__(self):
        self.process = None
        self.start_process()

    def start_process(self):
        """Launch a persistent Python interpreter in interactive mode."""
        python_cmd = 'python'  # or 'python3' or 'py'
        # Force unbuffered output and interactive mode
        self.process = subprocess.Popen(
            [python_cmd, '-i', '-u'],  # -i = interactive, -u = unbuffered
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=0,
            universal_newlines=True
        )
        # Read the initial prompt (">>> ")
        self._read_until_prompt()

    def _read_until_prompt(self):
        """Read output until we see the Python prompt '>>> ' or '... '."""
        output = ""
        while True:
            char = self.process.stdout.read(1)
            if not char:
                break
            output += char
            if output.endswith('>>> ') or output.endswith('... '):
                break
        return output

    def execute(self, command):
        if self.process is None or self.process.poll() is not None:
            self.start_process()
        # Send the command
        self.process.stdin.write(command + '\n')
        self.process.stdin.flush()
        # Read output until next prompt
        output = self._read_until_prompt()
        # Remove the command echo (first line)
        lines = output.splitlines()
        if lines and command in lines[0]:
            lines = lines[1:]
        # Remove the trailing prompt
        if lines and (lines[-1].endswith('>>> ') or lines[-1].endswith('... ')):
            lines = lines[:-1]
        return '\n'.join(lines) + '\n'

    def restart(self):
        if self.process:
            self.process.terminate()
        self.start_process()