/*
 * Runs learner code with a real CPython interpreter compiled to WebAssembly
 * (Pyodide), entirely inside this Worker. Nothing here ever leaves the
 * visitor's machine — there is no server on the other end of this.
 *
 * Message protocol (main thread -> worker):
 *   { type: 'init' }                     -> worker replies { type: 'ready' } or { type: 'error', message }
 *   { type: 'run', code, stdin }         -> worker replies { type: 'result', payload: {output, error, error_info, notes} }
 *
 * If the worker is terminated mid-run (the main thread does this when a run
 * exceeds its time limit, e.g. an infinite loop), it simply stops existing;
 * the main thread starts a fresh one for the next run.
 */

const PYODIDE_VERSION = 'v0.26.4';
importScripts(`https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/pyodide.js`);

let pyodide = null;
let runUserCode = null;

// Runs the learner's code with a fresh set of globals every time (so one
// run's variables never leak into the next, matching a brand-new Python
// process), captures stdout/stderr, and turns a fake input() into whatever
// stdin text was supplied up front.
const DRIVER_SOURCE = `
import sys, io, json, traceback

def __run_user_code(code, stdin_text):
    remaining = list(stdin_text.split('\\n')) if stdin_text else []

    def fake_input(prompt=''):
        if remaining:
            return remaining.pop(0)
        raise EOFError('EOF when reading a line')

    sandbox_globals = {'__name__': '__main__', 'input': fake_input}

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout_buf, stderr_buf

    error_text = None
    try:
        compiled = compile(code, '<usercode>', 'exec')
        exec(compiled, sandbox_globals)
    except SystemExit:
        pass
    except BaseException:
        error_text = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err

    result = {'output': stdout_buf.getvalue().strip(), 'error': None, 'error_info': None, 'notes': ''}
    if error_text:
        result['error'] = error_text.strip()
        try:
            result['error_info'] = explain(error_text, '<usercode>')
        except Exception:
            result['error_info'] = None
    else:
        result['notes'] = stderr_buf.getvalue().strip()
    return json.dumps(result)
`;

async function init() {
    pyodide = await loadPyodide();
    const helperUrl = new URL('py_error_helper.py', self.location.href).href;
    const helperSource = await (await fetch(helperUrl)).text();
    pyodide.runPython(helperSource);
    pyodide.runPython(DRIVER_SOURCE);
    runUserCode = pyodide.globals.get('__run_user_code');
}

self.onmessage = async (event) => {
    const msg = event.data;

    if (msg.type === 'init') {
        try {
            await init();
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({ type: 'error', message: String(err && err.message || err) });
        }
        return;
    }

    if (msg.type === 'run') {
        try {
            const resultJson = runUserCode(msg.code, msg.stdin || '');
            self.postMessage({ type: 'result', payload: JSON.parse(resultJson) });
        } catch (err) {
            self.postMessage({
                type: 'result',
                payload: { output: '', error: String(err && err.message || err), error_info: null, notes: '' },
            });
        }
    }
};
