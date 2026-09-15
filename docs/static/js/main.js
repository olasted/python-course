'use strict';

/*
 * This is the browser-only build of the course. There is no server: your
 * code runs through a real Python interpreter compiled to WebAssembly
 * (Pyodide, see pyworker.js) right here in the tab, and your progress lives
 * in this browser's localStorage. Nothing is ever sent anywhere. That also
 * means progress doesn't follow you to another browser or device, and
 * clearing site data for this page clears it for good.
 */

/* =========================================================
   State and constants
   ========================================================= */

const KEYS = {
    theme:    'py-course-theme',
    session:  'py-course-session',
    hotkeys:  'py-course-hotkeys',
    code:     'py-course-code:',
    inputs:   'py-course-inputs:',
    progress: 'py-course-progress',
};

const DEFAULT_HOTKEYS = [
    { id: 'parens',   shift: true, ctrl: false, alt: false, key: 'x', pair: '()' },
    { id: 'braces',   shift: true, ctrl: false, alt: false, key: 'c', pair: '{}' },
    { id: 'brackets', shift: true, ctrl: false, alt: false, key: 'v', pair: '[]' },
];

const state = {
    editor:     null,
    days:       [],       // [{ day, title, total, completed }]
    day:        null,
    dayData:    null,
    tasks:      [],
    targetId:   null,
    attempts:   {},       // taskId -> failed runs this session
    hintsOpen:  {},       // taskId -> number of hint steps revealed
    errorDecos: [],
    reference:  null,
    totalTasks: 0,
    pyReady:    false,
    saveTimer:  null,
    hotkeyDisposables: [],
    hotkeyCounter: 0,
    captureCanceller: null,
};

const $ = (id) => document.getElementById(id);

const el = {
    daySelect:      $('daySelect'),
    prevDayBtn:     $('prevDayBtn'),
    nextDayBtn:     $('nextDayBtn'),
    progressBar:    $('progressBar'),
    progressText:   $('progressText'),
    streakBadge:    $('streakBadge'),
    streakCount:    $('streakCount'),
    overviewBtn:    $('overviewBtn'),
    referenceBtn:   $('referenceBtn'),
    resetBtn:       $('resetBtn'),
    themeBtn:       $('themeBtn'),
    menuBtn:        $('menuBtn'),
    sidePanel:      $('sidePanel'),
    sideScroll:     $('sideScroll'),
    lessonView:     $('lessonView'),
    tasksView:      $('tasksView'),
    taskCount:      $('taskCount'),
    workTarget:     $('workTarget'),
    clearBtn:       $('clearBtn'),
    runBtn:         $('runBtn'),
    outputPanel:    $('outputPanel'),
    outputStatus:   $('outputStatus'),
    outputBody:     $('outputBody'),
    menuPanel:      $('menuPanel'),
    menuHotkeys:    $('menuHotkeys'),
    hotkeyPanel:    $('hotkeyPanel'),
    overviewOverlay: $('overviewOverlay'),
    overviewSummary: $('overviewSummary'),
    overviewList:   $('overviewList'),
    referenceDrawer: $('referenceDrawer'),
    drawerBackdrop: $('drawerBackdrop'),
    referenceSearch: $('referenceSearch'),
    referenceBody:  $('referenceBody'),
    toast:          $('toast'),
};

/* =========================================================
   Small helpers
   ========================================================= */

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Escapes HTML, then turns `code` into <code> and **bold** into <strong>.
function inline(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// Paragraph blocks separated by blank lines. A block whose lines all start
// with "- " becomes a list.
function paragraphs(text) {
    if (!text) return '';
    return text.split(/\n\s*\n/).map(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length && lines.every(l => l.startsWith('- '))) {
            return '<ul>' + lines.map(l => `<li>${inline(l.slice(2))}</li>`).join('') + '</ul>';
        }
        return `<p>${inline(lines.join(' '))}</p>`;
    }).join('');
}

function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

function starterFor(day) {
    const d = state.days.find(x => x.day === day);
    const title = d ? d.title : '';
    return `# Day ${day}${title ? ' · ' + title : ''}\n\n`;
}

function showToast(text, ms = 2200) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function store(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) {}
}
function load(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : raw;
    } catch (_) { return fallback; }
}
function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}

async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
}

/* =========================================================
   Progress — everything a server would normally track, kept
   in this browser's localStorage instead.
   ========================================================= */

function loadProgress() {
    return loadJson(KEYS.progress, { tasks: {}, streak: 0, last_active: null });
}

function saveProgress(p) { store(KEYS.progress, p); }

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function updateTaskStatus(taskId, status) {
    const p = loadProgress();
    p.tasks[taskId] = status;
    if (status === 'completed') {
        const today = todayStr();
        if (p.last_active !== today) {
            p.streak = (p.last_active === yesterdayStr()) ? p.streak + 1 : 1;
            p.last_active = today;
        }
    }
    saveProgress(p);
    refreshDayCompletion();
    applyStats(getStats(state.totalTasks));
}

function getStats(totalTasks) {
    const p = loadProgress();
    const completed = Object.values(p.tasks).filter(v => v === 'completed').length;
    const total = totalTasks != null ? totalTasks : Object.keys(p.tasks).length;
    const percentage = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
    const streak = (p.last_active === todayStr() || p.last_active === yesterdayStr()) ? p.streak : 0;
    return { completed, total, percentage, streak, last_active: p.last_active };
}

function dayProgress(day) {
    const p = loadProgress();
    const prefix = `${day}.`;
    const out = {};
    for (const [k, v] of Object.entries(p.tasks)) if (k.startsWith(prefix)) out[k] = v;
    return out;
}

function completedIds() {
    const p = loadProgress();
    return new Set(Object.entries(p.tasks).filter(([, v]) => v === 'completed').map(([k]) => k));
}

function resetProgressData() {
    saveProgress({ tasks: {}, streak: 0, last_active: null });
}

function refreshDayCompletion() {
    const done = completedIds();
    state.days.forEach(d => {
        const prefix = `${d.day}.`;
        let count = 0;
        done.forEach(id => { if (id.startsWith(prefix)) count++; });
        d.completed = count;
    });
}

/* =========================================================
   Theme
   ========================================================= */

function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    store(KEYS.theme, theme);
    if (window.monaco) monaco.editor.setTheme(theme === 'dark' ? 'course-dark' : 'course-light');
}

el.themeBtn.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
});

/* =========================================================
   Python runtime — a real CPython, compiled to WebAssembly,
   running in a Worker so a hung program can be hard-stopped.
   ========================================================= */

const RUN_TIMEOUT_MS = 10000;

const TIMEOUT_INFO = {
    type: 'Timeout', message: '', line: null,
    title: "Your program ran too long and was stopped",
    explanation: "It didn't finish within the time limit. Nine times out of ten that's a loop that never ends: a while condition that never becomes False, or a counter that never changes.",
    fixes: [
        "Check that something inside the while loop changes the condition each time, e.g. i += 1.",
        "If you use while True:, make sure there's a break that can actually be reached.",
        "If the program is waiting for input(), make sure you supplied enough input values.",
    ],
    traceback: `Execution timed out (${RUN_TIMEOUT_MS / 1000}s limit)`,
};

let pyWorker = null;
let pyReadyPromise = null;
let pendingRun = null;

function setRunButton(label, disabled) {
    el.runBtn.innerHTML = label;
    el.runBtn.disabled = disabled;
}

function startPyWorker() {
    pyWorker = new Worker('static/js/pyworker.js');
    pyReadyPromise = new Promise((resolve, reject) => {
        pyWorker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'ready') {
                state.pyReady = true;
                setRunButton('Run <kbd>Ctrl&#8239;&#9166;</kbd>', false);
                resolve();
            } else if (msg.type === 'error') {
                console.error('Python runtime failed to start:', msg.message);
                setRunButton('Python failed to load', true);
                reject(new Error(msg.message));
            } else if (msg.type === 'result' && pendingRun) {
                const done = pendingRun.resolve;
                pendingRun = null;
                done(msg.payload);
            }
        };
        pyWorker.onerror = (e) => {
            console.error('Worker error:', e.message || e);
            if (pendingRun) {
                pendingRun.resolve({ output: '', error: String(e.message || e), error_info: null, notes: '' });
                pendingRun = null;
            }
        };
    });
    pyWorker.postMessage({ type: 'init' });
    return pyReadyPromise;
}

function runPython(code, stdin) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (payload) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(payload);
        };
        const timer = setTimeout(() => {
            // A worker can be killed even mid-loop, unlike the main thread.
            // That's the whole reason code execution lives in one.
            pyWorker.terminate();
            state.pyReady = false;
            setRunButton('Restarting Python…', true);
            finish({ output: '', error: TIMEOUT_INFO.traceback, error_info: TIMEOUT_INFO, notes: '' });
            startPyWorker().catch(() => {});
        }, RUN_TIMEOUT_MS);

        pendingRun = { resolve: finish };
        pyWorker.postMessage({ type: 'run', code, stdin: stdin || '' });
    });
}

/* =========================================================
   Editor
   ========================================================= */

require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
    monaco.editor.defineTheme('course-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'keyword',    foreground: '8a4b9c' },
            { token: 'string',     foreground: '3f7a4b' },
            { token: 'number',     foreground: 'b0651f' },
            { token: 'comment',    foreground: '9a9184', fontStyle: 'italic' },
            { token: 'tag',        foreground: '2f6c8f' },
            { token: 'delimiter',  foreground: '625c53' },
            { token: 'operator',   foreground: '625c53' },
        ],
        colors: {
            'editor.background':                   '#fbf9f5',
            'editor.foreground':                   '#2b2925',
            'editor.lineHighlightBackground':      '#f3efe7',
            'editor.lineHighlightBorder':          '#00000000',
            'editorLineNumber.foreground':         '#c2bbad',
            'editorLineNumber.activeForeground':   '#978f83',
            'editorCursor.foreground':             '#b0651f',
            'editor.selectionBackground':          '#f3e4d3',
            'editor.inactiveSelectionBackground':  '#f1ede5',
            'editorIndentGuide.background1':       '#e9e4da',
            'editorIndentGuide.activeBackground1': '#cfc7b8',
            'editorBracketMatch.background':       '#f3e4d3',
            'editorBracketMatch.border':           '#cfc7b8',
            'editorWidget.background':             '#ffffff',
            'editorWidget.border':                 '#e3ddd2',
            'editorSuggestWidget.background':      '#ffffff',
            'editorSuggestWidget.border':          '#e3ddd2',
            'editorSuggestWidget.selectedBackground': '#f3e4d3',
            'editorHoverWidget.background':        '#ffffff',
            'editorHoverWidget.border':            '#e3ddd2',
            'scrollbarSlider.background':          '#cfc7b866',
            'scrollbarSlider.hoverBackground':     '#cfc7b8aa',
            'scrollbarSlider.activeBackground':    '#cfc7b8cc',
            'scrollbar.shadow':                    '#00000000',
        },
    });

    monaco.editor.defineTheme('course-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword',    foreground: 'c99ad6' },
            { token: 'string',     foreground: '8cc796' },
            { token: 'number',     foreground: 'e2a35d' },
            { token: 'comment',    foreground: '7f786d', fontStyle: 'italic' },
            { token: 'tag',        foreground: '7fb3d5' },
            { token: 'delimiter',  foreground: 'b5aea2' },
            { token: 'operator',   foreground: 'b5aea2' },
        ],
        colors: {
            'editor.background':                   '#1f1e1b',
            'editor.foreground':                   '#ebe7de',
            'editor.lineHighlightBackground':      '#262522',
            'editor.lineHighlightBorder':          '#00000000',
            'editorLineNumber.foreground':         '#4d4a43',
            'editorLineNumber.activeForeground':   '#7f786d',
            'editorCursor.foreground':             '#e2a35d',
            'editor.selectionBackground':          '#3a3026',
            'editor.inactiveSelectionBackground':  '#2a2926',
            'editorIndentGuide.background1':       '#2f2e2a',
            'editorIndentGuide.activeBackground1': '#47443d',
            'editorBracketMatch.background':       '#3a3026',
            'editorBracketMatch.border':           '#47443d',
            'editorWidget.background':             '#292825',
            'editorWidget.border':                 '#34322d',
            'editorSuggestWidget.background':      '#292825',
            'editorSuggestWidget.border':          '#34322d',
            'editorSuggestWidget.selectedBackground': '#3a3026',
            'editorHoverWidget.background':        '#292825',
            'editorHoverWidget.border':            '#34322d',
            'scrollbarSlider.background':          '#47443d66',
            'scrollbarSlider.hoverBackground':     '#47443daa',
            'scrollbarSlider.activeBackground':    '#47443dcc',
            'scrollbar.shadow':                    '#00000000',
        },
    });

    state.editor = monaco.editor.create($('monacoEditor'), {
        value: '',
        language: 'python',
        theme: currentTheme() === 'dark' ? 'course-dark' : 'course-light',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        lineHeight: 22,
        fontFamily: "'IBM Plex Mono', 'Cascadia Code', Consolas, monospace",
        fontLigatures: false,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        renderWhitespace: 'none',
        renderLineHighlight: 'line',
        tabSize: 4,
        insertSpaces: true,
        padding: { top: 14, bottom: 14 },
        bracketPairColorization: { enabled: false },
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        cursorBlinking: 'smooth',
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
        wordWrap: 'off',
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        folding: false,
        contextmenu: false,
    });

    state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);
    state.editor.onDidChangeModelContent(() => { clearErrorMark(); scheduleSave(); });

    init();
});

function setEditorValue(text, keepUndo = true) {
    const ed = state.editor;
    if (!ed) return;
    if (!keepUndo) { ed.setValue(text); return; }
    const model = ed.getModel();
    ed.executeEdits('course', [{ range: model.getFullModelRange(), text, forceMoveMarkers: true }]);
}

function editorIsUntouched() {
    if (!state.editor) return true;
    const cur = state.editor.getValue().trim();
    return cur === '' || cur === starterFor(state.day).trim();
}

// Puts a chunk of code into the editor. Replaces a blank/starter editor,
// otherwise appends below a comment so nothing is lost.
function insertCode(code, label) {
    const ed = state.editor;
    if (!ed) return;
    const clean = code.replace(/\s+$/, '') + '\n';
    if (editorIsUntouched()) {
        setEditorValue(starterFor(state.day) + clean);
    } else {
        const cur = ed.getValue().replace(/\s+$/, '');
        setEditorValue(cur + `\n\n# ${label}\n` + clean);
    }
    const lastLine = ed.getModel().getLineCount();
    ed.setPosition({ lineNumber: lastLine, column: 1 });
    ed.revealLineInCenter(lastLine);
    ed.focus();
}

function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        if (state.editor && state.day != null) store(KEYS.code + state.day, state.editor.getValue());
    }, 350);
}

function restoreEditorForDay(day) {
    const saved = load(KEYS.code + day, null);
    const text  = (saved && saved.trim()) ? saved : starterFor(day);
    setEditorValue(text, false);
    const last = state.editor.getModel().getLineCount();
    state.editor.setPosition({ lineNumber: last, column: state.editor.getModel().getLineMaxColumn(last) });
}

// Wipes the editor back to the day's starter comment, keeping undo history
// so Ctrl+Z can bring the code back (used when a task is finished, and by
// the manual Clear button).
function resetEditorToStarter() {
    if (!state.editor) return;
    setEditorValue(starterFor(state.day));
    const last = state.editor.getModel().getLineCount();
    state.editor.setPosition({ lineNumber: last, column: 1 });
}

function markErrorLine(line) {
    if (!state.editor || !line) return;
    const range = new monaco.Range(line, 1, line, 1);
    state.errorDecos = state.editor.deltaDecorations(state.errorDecos, [{
        range,
        options: { isWholeLine: true, className: 'error-line', linesDecorationsClassName: 'error-gutter' },
    }]);
    state.editor.revealLineInCenterIfOutsideViewport(line);
}

function clearErrorMark() {
    if (state.editor && state.errorDecos.length) {
        state.errorDecos = state.editor.deltaDecorations(state.errorDecos, []);
    }
}

/* =========================================================
   Layout: draggable dividers
   ========================================================= */

function initResizers() {
    const leftDivider   = $('leftDivider');
    const bottomDivider = $('bottomDivider');
    const workPanel     = $('workPanel');
    let dragging = null, startX, startY, startW, startH;

    leftDivider.addEventListener('mousedown', (e) => {
        dragging = 'left'; startX = e.clientX; startW = el.sidePanel.offsetWidth;
        leftDivider.classList.add('active'); document.body.classList.add('drag-h'); e.preventDefault();
    });
    bottomDivider.addEventListener('mousedown', (e) => {
        dragging = 'bottom'; startY = e.clientY; startH = el.outputPanel.offsetHeight;
        bottomDivider.classList.add('active'); document.body.classList.add('drag-v'); e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        if (dragging === 'left') {
            const w = Math.max(280, Math.min(680, startW + (e.clientX - startX)));
            el.sidePanel.style.width = w + 'px';
        } else {
            const h = Math.max(80, Math.min(workPanel.offsetHeight - 140, startH - (e.clientY - startY)));
            el.outputPanel.style.height = h + 'px';
        }
        if (state.editor) state.editor.layout();
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        leftDivider.classList.remove('active'); bottomDivider.classList.remove('active');
        document.body.classList.remove('drag-h', 'drag-v');
        dragging = null;
        if (state.editor) state.editor.layout();
    });
}

/* =========================================================
   Days
   ========================================================= */

async function init() {
    initResizers();
    registerEditorHotkeys();
    bindUi();
    startPyWorker().catch(() => {}); // runCode()/executeCode() await this when needed

    let manifest;
    try {
        manifest = await api('data/manifest.json');
    } catch (err) {
        console.error(err);
        el.lessonView.innerHTML = '<p class="lesson-empty">Could not load the course files. Try reloading the page.</p>';
        return;
    }
    if (!manifest.length) {
        el.lessonView.innerHTML = '<p class="lesson-empty">No course days were found.</p>';
        return;
    }

    state.totalTasks = manifest.reduce((sum, d) => sum + d.total, 0);
    state.days = manifest.map(d => ({ ...d, completed: 0 }));
    refreshDayCompletion();
    applyStats(getStats(state.totalTasks));

    el.daySelect.innerHTML = '';
    state.days.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.day;
        opt.textContent = `Day ${d.day} · ${d.title}`;
        el.daySelect.appendChild(opt);
    });

    const session = loadJson(KEYS.session, {});
    let day = state.days.some(d => d.day === session.day) ? session.day : null;
    if (day == null) {
        const firstOpen = state.days.find(d => d.completed < d.total);
        day = firstOpen ? firstOpen.day : state.days[0].day;
    }

    // Optional deep link: ?day=5&tab=lesson
    const params = new URLSearchParams(location.search);
    const linkDay = Number(params.get('day'));
    const linkTab = params.get('tab');
    if (linkDay && state.days.some(d => d.day === linkDay)) day = linkDay;
    if (linkTab === 'lesson' || linkTab === 'tasks') store(KEYS.session, { ...session, day, tab: linkTab });

    await loadDay(day, { restore: true });
}

async function loadDay(day, { restore = false } = {}) {
    let raw;
    try {
        raw = await api(`data/days/day_${pad3(day)}.json`);
    } catch (err) {
        console.error(err);
        showToast(`Day ${day} could not be loaded.`);
        return;
    }

    if (state.editor && state.day != null) store(KEYS.code + state.day, state.editor.getValue());

    const progress = dayProgress(day);
    const data = { ...raw, tasks: raw.tasks.map(t => ({ ...t, status: progress[t.id] || 'not_started' })) };

    state.day     = day;
    state.dayData = data;
    state.tasks   = data.tasks;
    el.daySelect.value = String(day);

    const idx = state.days.findIndex(d => d.day === day);
    el.prevDayBtn.disabled = idx <= 0;
    el.nextDayBtn.disabled = idx >= state.days.length - 1;

    const session = restore ? loadJson(KEYS.session, {}) : {};
    const restored = restore && session.taskId && state.tasks.find(t => t.id === session.taskId);
    const firstOpen = state.tasks.find(t => t.status !== 'completed');
    state.targetId = restored ? session.taskId : (firstOpen ? firstOpen.id : null);

    renderLesson();
    renderTasks();
    updateWorkTarget();
    restoreEditorForDay(day);
    clearOutput();

    const anyDone = state.tasks.some(t => t.status === 'completed');
    const tab = (restore && session.tab) ? session.tab : (anyDone || !data.lesson ? 'tasks' : 'lesson');
    setTab(tab, { scrollTop: true });

    persistSession();
}

function goToDay(day) {
    if (!state.days.some(d => d.day === day)) return;
    loadDay(day);
}

function stepDay(delta) {
    const idx = state.days.findIndex(d => d.day === state.day);
    const next = state.days[idx + delta];
    if (next) goToDay(next.day);
}

function persistSession() {
    const activeTab = document.querySelector('.side-tab.is-active')?.dataset.tab || 'lesson';
    store(KEYS.session, { day: state.day, taskId: state.targetId, tab: activeTab });
}

/* =========================================================
   Side panel: tabs, lesson, tasks
   ========================================================= */

function setTab(name, { scrollTop = false } = {}) {
    document.querySelectorAll('.side-tab').forEach(btn => {
        const on = btn.dataset.tab === name;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.lessonView.hidden = name !== 'lesson';
    el.tasksView.hidden  = name !== 'tasks';
    if (scrollTop) el.sideScroll.scrollTop = 0;
    persistSession();
}

function renderLesson() {
    const d = state.dayData;
    const lesson = d.lesson;
    const parts = [];
    parts.push(`<div class="lesson-kicker">Day ${d.day}</div>`);
    parts.push(`<h1>${escapeHtml(d.title)}</h1>`);

    if (!lesson) {
        parts.push('<p class="lesson-empty">There is no written lesson for this day yet. The tasks and their hints have everything you need.</p>');
        parts.push('<div class="lesson-next"><button class="btn btn-primary" data-go-tasks>Go to the tasks</button></div>');
        el.lessonView.innerHTML = parts.join('');
        return;
    }

    if (lesson.intro) parts.push(`<div class="lesson-intro">${paragraphs(lesson.intro)}</div>`);

    (lesson.sections || []).forEach((s, i) => {
        if (s.heading) parts.push(`<h2>${escapeHtml(s.heading)}</h2>`);
        if (s.body) parts.push(paragraphs(s.body));
        if (s.code) {
            parts.push(`
                <div class="example" data-example="${i}">
                    <div class="example-head">
                        <span class="example-label">Example</span>
                        <button class="btn-small" data-try="${i}">Try it in the editor</button>
                    </div>
                    <pre>${escapeHtml(s.code.replace(/\s+$/, ''))}</pre>
                    ${s.output != null && s.output !== '' ? `
                    <div class="example-out">
                        <div class="example-out-label">prints</div>
                        <pre>${escapeHtml(s.output.replace(/\s+$/, ''))}</pre>
                    </div>` : ''}
                </div>`);
        }
    });

    if (lesson.watch_out && lesson.watch_out.length) {
        parts.push(`<div class="watch-out"><h2>Things that trip people up</h2><ul>${
            lesson.watch_out.map(w => `<li>${inline(w)}</li>`).join('')
        }</ul></div>`);
    }

    parts.push('<div class="lesson-next"><button class="btn btn-primary" data-go-tasks>Go to the tasks</button></div>');
    el.lessonView.innerHTML = parts.join('');

    el.lessonView.querySelectorAll('[data-try]').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = lesson.sections[Number(btn.dataset.try)];
            insertCode(s.code, `Example: ${s.heading || 'from the lesson'}`);
            showToast('Example added to the editor. Press Run to see it.');
        });
    });
}

function taskDoneCount() {
    return state.tasks.filter(t => t.status === 'completed').length;
}

function updateTaskCount() {
    const done = taskDoneCount();
    el.taskCount.textContent = state.tasks.length ? `${done}/${state.tasks.length}` : '';
    const head = el.tasksView.querySelector('.tasks-head span');
    if (head) head.textContent = `${done} of ${state.tasks.length} done`;
}

function renderTasks() {
    const frag = document.createDocumentFragment();

    const head = document.createElement('div');
    head.className = 'tasks-head';
    head.innerHTML = `<h2>Day ${state.day} tasks</h2><span></span>`;
    frag.appendChild(head);

    state.tasks.forEach(task => frag.appendChild(buildTaskCard(task)));

    const doneBox = document.createElement('div');
    doneBox.className = 'tasks-done';
    doneBox.hidden = true;
    frag.appendChild(doneBox);

    el.tasksView.replaceChildren(frag);
    updateTaskCount();
    updateDoneBox();
}

function updateDoneBox() {
    const box = el.tasksView.querySelector('.tasks-done');
    if (!box) return;
    const allDone = state.tasks.length && state.tasks.every(t => t.status === 'completed');
    box.hidden = !allDone;
    if (!allDone) return;
    const idx  = state.days.findIndex(d => d.day === state.day);
    const next = state.days[idx + 1];
    box.innerHTML = `That's every task for day ${state.day}. ${next ? `<button data-next-day>Carry on to day ${next.day}: ${escapeHtml(next.title)}</button>` : 'And that was the last day of the course.'}`;
    box.querySelector('[data-next-day]')?.addEventListener('click', () => goToDay(next.day));
}

function buildTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task' + (task.status === 'completed' ? ' is-done' : '') + (task.id === state.targetId ? ' is-target' : '');
    card.dataset.id = task.id;

    card.innerHTML = `
        <div class="task-row">
            <input type="checkbox" class="task-check" title="Mark as done" ${task.status === 'completed' ? 'checked' : ''}>
            <div class="task-main">
                <div class="task-meta">
                    <span class="task-num">${escapeHtml(task.id)}</span>
                    ${task.expected ? '' : '<span class="task-flag">not checked automatically</span>'}
                </div>
                <div class="task-desc">${inline(task.description)}</div>
                <div class="task-actions">
                    ${task.hint ? '<button class="btn-small act-hint">Hint</button>' : ''}
                    ${task.solution ? '<button class="btn-small act-solution">Solution</button>' : ''}
                </div>
                <div class="task-extra"></div>
            </div>
        </div>`;

    card.addEventListener('click', (e) => {
        if (e.target.closest('input, button, .task-extra')) return;
        setTarget(task.id);
    });

    card.querySelector('.task-check').addEventListener('change', (e) => {
        const done = e.target.checked;
        task.status = done ? 'completed' : 'not_started';
        card.classList.toggle('is-done', done);
        if (done) {
            card.classList.add('flash');
            setTimeout(() => card.classList.remove('flash'), 800);
            if (task.id === state.targetId) advanceTarget();
        }
        updateTaskStatus(task.id, task.status);
        updateTaskCount();
        updateDoneBox();
    });

    const hintBtn = card.querySelector('.act-hint');
    if (hintBtn) hintBtn.addEventListener('click', () => toggleHint(task, card));

    const solBtn = card.querySelector('.act-solution');
    if (solBtn) solBtn.addEventListener('click', () => toggleSolution(task, card));

    return card;
}

// One step per line. Indented lines (like a code example under "Structure:")
// belong to the step above them.
function hintSteps(task) {
    const steps = [];
    (task.hint || '').split('\n').forEach(raw => {
        const line = raw.trim();
        if (!line) return;
        if (/^\s/.test(raw) && steps.length) steps[steps.length - 1] += '\n' + line;
        else steps.push(line);
    });
    return steps;
}

function toggleHint(task, card, { forceOpen = false } = {}) {
    const extra = card.querySelector('.task-extra');
    const btn   = card.querySelector('.act-hint');
    const open  = extra.querySelector('.hint-box');
    if (open && !forceOpen) {
        open.remove();
        btn.textContent = 'Hint';
        btn.classList.remove('is-open');
        return;
    }
    if (open) return;
    if (!state.hintsOpen[task.id]) state.hintsOpen[task.id] = 1;
    renderHintBox(task, card);
    btn.textContent = 'Hide hint';
    btn.classList.add('is-open');
}

function renderHintBox(task, card) {
    const extra = card.querySelector('.task-extra');
    const steps = hintSteps(task);
    const shown = Math.min(state.hintsOpen[task.id] || 1, steps.length);
    let box = extra.querySelector('.hint-box');
    if (!box) {
        box = document.createElement('div');
        box.className = 'hint-box';
        extra.prepend(box);
    }
    box.innerHTML = steps.slice(0, shown).map((s, i) =>
        `<div class="hint-step"><span class="hint-n">${i + 1}.</span><div>${inline(s).replace(/\n/g, '<br>')}</div></div>`
    ).join('') + (shown < steps.length
        ? `<div class="hint-more"><button data-more>Show the next hint</button><span>${shown} of ${steps.length}</span></div>`
        : '');
    box.querySelector('[data-more]')?.addEventListener('click', () => {
        state.hintsOpen[task.id] = shown + 1;
        renderHintBox(task, card);
    });
}

function toggleSolution(task, card, { forceOpen = false } = {}) {
    const extra = card.querySelector('.task-extra');
    const btn   = card.querySelector('.act-solution');
    const open  = extra.querySelector('.solution-box');
    if (open && !forceOpen) {
        open.remove();
        btn.textContent = 'Solution';
        btn.classList.remove('is-open');
        return;
    }
    if (open) return;

    const box = document.createElement('div');
    box.className = 'solution-box';
    box.innerHTML = `
        <div class="example-head">
            <span class="example-label">One way to do it</span>
            <button class="btn-small" data-add>Add to editor</button>
        </div>
        <pre>${escapeHtml(task.solution.replace(/\s+$/, ''))}</pre>
        ${task.walkthrough ? `<div class="solution-walk"><div class="solution-walk-label">How it works</div>${
            task.walkthrough.split('\n').map(l => l.trim()).filter(Boolean).map(l => `<p>${inline(l)}</p>`).join('')
        }</div>` : ''}`;
    box.querySelector('[data-add]').addEventListener('click', () => {
        insertCode(task.solution, `Solution for ${task.id}`);
        if (task.solution_stdin) {
            store(KEYS.inputs + state.day, task.solution_stdin.replace(/\n$/, ''));
            showToast('Solution added, with sample answers for its input() calls.');
        } else {
            showToast('Solution added to the editor.');
        }
    });
    extra.appendChild(box);
    btn.textContent = 'Hide solution';
    btn.classList.add('is-open');
}

function setTarget(taskId) {
    state.targetId = taskId;
    document.querySelectorAll('.task.is-target').forEach(c => c.classList.remove('is-target'));
    if (taskId) document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`)?.classList.add('is-target');
    updateWorkTarget();
    persistSession();
}

function getTarget() {
    return state.targetId ? state.tasks.find(t => t.id === state.targetId) : null;
}

function advanceTarget() {
    const cur  = getTarget();
    const rest = state.tasks.filter(t => t.status !== 'completed' && t.id !== cur?.id);
    // Prefer the next task after the current one, otherwise the first open one.
    const curIdx = state.tasks.findIndex(t => t.id === cur?.id);
    const after  = state.tasks.slice(curIdx + 1).find(t => t.status !== 'completed');
    const next   = after || rest[0] || null;
    setTarget(next ? next.id : null);
    if (next) scrollToTask(next.id);
    return next;
}

function scrollToTask(taskId) {
    const card = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateWorkTarget() {
    const t = getTarget();
    if (t) {
        el.workTarget.textContent = `working on ${t.id}` + (t.expected ? '' : ' (not checked automatically)');
    } else if (state.tasks.length && state.tasks.every(x => x.status === 'completed')) {
        el.workTarget.textContent = `day ${state.day} is done, this is free space`;
    } else {
        el.workTarget.textContent = 'pick a task to work on';
    }
}

/* =========================================================
   Running code
   ========================================================= */

async function runCode() {
    if (!state.editor || el.runBtn.disabled) return;
    const code = state.editor.getValue();
    if (!code.trim() || code.trim() === starterFor(state.day).trim()) {
        setStatus('Nothing to run yet. Write some code first.', '');
        return;
    }
    let stdin = '';
    if (/\binput\s*\(/.test(code)) {
        stdin = await collectInputs(code);
        if (stdin === null) return;
    }
    await executeCode(code, stdin);
}

function setStatus(text, kind) {
    el.outputStatus.textContent = text;
    el.outputStatus.className = 'output-status' + (kind ? ' ' + kind : '');
}

function clearOutput() {
    setStatus('', '');
    el.outputBody.innerHTML = '<p class="output-empty">Run your code and the output will show up here.</p>';
}

function collectInputs(code) {
    return new Promise((resolve) => {
        const count = (code.match(/\binput\s*\(/g) || []).length;
        const remembered = load(KEYS.inputs + state.day, '');

        const { overlay, dialog } = buildDialog(`
            <div class="dialog-head"><h2>Your program asks for input</h2></div>
            <p class="dialog-sub">It calls <code>input()</code> ${count === 1 ? 'once' : count + ' times'}. Type one answer per line, in the order the program will ask. If a call is inside a loop, add a line for each time round.</p>
            <div class="field">
                <textarea id="stdinBox" rows="${Math.min(8, Math.max(3, count + 1))}" spellcheck="false"></textarea>
            </div>
            <div class="dialog-actions">
                <button class="btn btn-quiet" data-cancel>Cancel</button>
                <button class="btn btn-primary" data-ok>Run with these</button>
            </div>`);

        const box = dialog.querySelector('#stdinBox');
        box.style.cssText = 'width:100%;padding:.5rem .6rem;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font-mono);font-size:.86rem;resize:vertical;';
        box.value = remembered;
        setTimeout(() => box.focus(), 0);

        const finish = (value) => { overlay.remove(); resolve(value); };
        dialog.querySelector('[data-ok]').addEventListener('click', () => {
            store(KEYS.inputs + state.day, box.value);
            finish(box.value.replace(/\r/g, ''));
        });
        dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') finish(null);
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) dialog.querySelector('[data-ok]').click();
        });
    });
}

async function executeCode(code, stdin) {
    const target   = getTarget();
    const expected = target?.expected || '';

    clearErrorMark();
    setStatus('Running…', '');
    const wasDisabled = el.runBtn.disabled;
    el.runBtn.disabled = true;

    if (!state.pyReady) {
        setStatus('Python is still loading, one moment…', '');
        try { await pyReadyPromise; }
        catch (_) {
            setStatus('Python could not be loaded. Reload the page to try again.', 'bad');
            el.runBtn.disabled = wasDisabled;
            return;
        }
    }

    const result = await runPython(code, stdin);
    el.runBtn.disabled = state.pyReady ? false : wasDisabled;

    result.passed = !!(expected && !result.error && (result.output || '').trim() === expected.trim());

    const parts = [];

    if (result.error) {
        const info = result.error_info;
        if (info && info.line) markErrorLine(info.line);
        setStatus(info && info.line ? `Error on line ${info.line}` : 'Error', 'bad');
        parts.push(renderErrorCard(info, result.error));
        if (result.output) parts.push(`<div class="output-notes"><div class="output-notes-label">Printed before the error</div>${escapeHtml(result.output)}</div>`);
        if (target) {
            state.attempts[target.id] = (state.attempts[target.id] || 0) + 1;
            parts.push(renderNudge(target));
        }
        el.outputBody.innerHTML = parts.join('');
        bindNudge();
        return;
    }

    const output = result.output || '';

    if (target && expected) {
        if (result.passed) {
            const wasDone = target.status === 'completed';
            let next = null;
            if (!wasDone) {
                markComplete(target.id);
                next = advanceTarget();
                resetEditorToStarter();
            }
            const allDone = state.tasks.every(t => t.status === 'completed');
            if (wasDone) {
                setStatus('Still correct.', 'ok');
            } else if (next) {
                setStatus(`Correct. ${target.id} is done.`, 'ok');
                parts.push(`<div class="result-card result-ok"><h3>That's ${escapeHtml(target.id)} done</h3><p>${escapeHtml(next.id)} is up next. I've cleared the editor for it — if it builds on what you just wrote, Ctrl+Z brings that back.</p></div>`);
            } else if (allDone) {
                setStatus(`Day ${state.day} complete.`, 'ok');
                const idx = state.days.findIndex(d => d.day === state.day);
                const nd  = state.days[idx + 1];
                parts.push(`<div class="result-card result-ok"><h3>That's every task for day ${state.day}</h3><p>Nice going. ${nd ? `Whenever you're ready, day ${nd.day} is about ${escapeHtml(nd.title)}.` : 'That was the last day of the course.'}</p>${nd ? `<div class="inline-actions"><button class="btn-small" data-next-day="${nd.day}">Go to day ${nd.day}</button></div>` : ''}</div>`);
            } else {
                setStatus(`Correct. ${target.id} is done.`, 'ok');
                parts.push(`<div class="result-card result-ok"><h3>That's ${escapeHtml(target.id)} done</h3><p>The remaining tasks on this day aren't checked automatically. Pick one from the list when you're ready.</p></div>`);
            }
        } else {
            state.attempts[target.id] = (state.attempts[target.id] || 0) + 1;
            setStatus('Not quite. Compare the two below.', 'bad');
            parts.push(renderDiff(expected, output));
            parts.push(renderNudge(target));
        }
    } else if (target) {
        setStatus('Ran without errors.', 'ok');
        parts.push(`<div class="result-card result-info"><h3>Ran fine</h3><p>${escapeHtml(target.id)} isn't checked automatically. Look over the output, compare with the solution if you like, then tick the task off when you're happy with it.</p></div>`);
    } else {
        setStatus('Ran without errors.', 'ok');
    }

    parts.push(`<pre class="output-pre">${output ? escapeHtml(output) : '<span style="color:var(--text-3)">(the program printed nothing)</span>'}</pre>`);
    if (result.notes) {
        parts.push(`<div class="output-notes"><div class="output-notes-label">Also written to stderr (warnings, logging)</div>${escapeHtml(result.notes)}</div>`);
    }

    el.outputBody.innerHTML = parts.join('');
    bindNudge();
    el.outputBody.querySelector('[data-next-day]')?.addEventListener('click', (e) => goToDay(Number(e.currentTarget.dataset.nextDay)));
}

function renderErrorCard(info, rawError) {
    if (!info) {
        return `<div class="result-card result-error"><h3>Something went wrong</h3><pre>${escapeHtml(rawError)}</pre></div>`;
    }
    const where = info.line
        ? `<div class="error-where">Line ${info.line} · <code>${escapeHtml(info.type)}${info.message ? ': ' + escapeHtml(info.message) : ''}</code></div>`
        : `<div class="error-where"><code>${escapeHtml(info.type)}${info.message ? ': ' + escapeHtml(info.message) : ''}</code></div>`;
    return `
        <div class="result-card result-error">
            <h3>${inline(info.title)}</h3>
            ${where}
            <p>${inline(info.explanation)}</p>
            ${info.fixes && info.fixes.length ? `<ul>${info.fixes.map(f => `<li>${inline(f)}</li>`).join('')}</ul>` : ''}
            ${info.traceback ? `<details><summary>Show the full Python message</summary><pre>${escapeHtml(info.traceback)}</pre></details>` : ''}
        </div>`;
}

function renderNudge(task) {
    const n = state.attempts[task.id] || 0;
    if (n < 2) return '';
    const hasHint = !!task.hint, hasSol = !!task.solution;
    if (!hasHint && !hasSol) return '';
    let text;
    if (n >= 4 && hasSol) {
        text = `Still stuck on ${escapeHtml(task.id)}? That's normal. ${hasHint ? 'Read the hints, or open' : 'Open'} the solution and work backwards from it. Understanding why it works counts just as much.`;
    } else if (hasHint) {
        text = `Stuck on ${escapeHtml(task.id)}? The hints are a good place to start. They get more specific each step.`;
    } else {
        text = `Stuck on ${escapeHtml(task.id)}? Have another look at the lesson, and the solution is there if you need it.`;
    }
    return `<div class="result-card result-info"><p>${text}</p><div class="inline-actions">
        ${hasHint ? `<button class="btn-small" data-open-hint="${escapeHtml(task.id)}">Show a hint</button>` : ''}
        ${n >= 4 && hasSol ? `<button class="btn-small" data-open-solution="${escapeHtml(task.id)}">Show the solution</button>` : ''}
    </div></div>`;
}

function bindNudge() {
    el.outputBody.querySelectorAll('[data-open-hint]').forEach(b => b.addEventListener('click', () => openOnCard(b.dataset.openHint, 'hint')));
    el.outputBody.querySelectorAll('[data-open-solution]').forEach(b => b.addEventListener('click', () => openOnCard(b.dataset.openSolution, 'solution')));
}

function openOnCard(taskId, what) {
    const task = state.tasks.find(t => t.id === taskId);
    const card = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
    if (!task || !card) return;
    setTab('tasks');
    if (what === 'hint') toggleHint(task, card, { forceOpen: true });
    else toggleSolution(task, card, { forceOpen: true });
    scrollToTask(taskId);
}

/* ---------- expected vs actual ---------- */

function renderDiff(expected, actual) {
    const e = expected.replace(/\r/g, '').trim().split('\n');
    const a = actual.replace(/\r/g, '').trim().split('\n');
    const n = Math.max(e.length, a.length);
    const note = diffNote(expected, actual, e, a);

    const rows = [];
    for (let i = 0; i < n; i++) {
        const ex = e[i], ac = a[i];
        const same = ex === ac;
        rows.push(`<tr class="${same ? '' : 'differs'}">
            <td class="n">${i + 1}</td>
            <td>${ex === undefined ? '<span class="missing">nothing</span>' : showWs(ex)}</td>
            <td>${ac === undefined ? '<span class="missing">nothing</span>' : showWs(ac)}</td>
        </tr>`);
    }
    return `<div class="diff">
        ${note ? `<div class="diff-note">${note}</div>` : ''}
        <table>
            <thead><tr><th></th><th>Expected</th><th>Your output</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>
    </div>`;
}

function showWs(line) {
    const m = line.match(/^(.*?)(\s+)$/);
    if (!m) return escapeHtml(line) || '&nbsp;';
    return escapeHtml(m[1]) + `<span class="ws" title="trailing spaces">${'&nbsp;'.repeat(m[2].length)}</span>`;
}

function diffNote(expected, actual, e, a) {
    const ex = expected.trim(), ac = actual.trim();
    if (!ac) return 'Your program printed nothing. Is there a <code>print()</code>? Remember that a function only shows something if you print its result.';
    if (ex.toLowerCase() === ac.toLowerCase()) return 'Only the capitalisation is different. Check upper and lower case letters.';
    if (e.map(l => l.trimEnd()).join('\n') === a.map(l => l.trimEnd()).join('\n')) return 'Only trailing spaces differ. Look for a space before a closing quote, or <code>end=" "</code>.';
    if (ex.replace(/\s+/g, '') === ac.replace(/\s+/g, '')) {
        if (e.length !== a.length && a.length === 1) return 'The words are right but everything is on one line. Use one <code>print()</code> per line, or print inside the loop.';
        if (e.length !== a.length && e.length === 1) return 'The words are right but they are split across lines. Print them in a single <code>print()</code>.';
        return 'The characters are right but the spacing is different. Check spaces around punctuation and inside your strings.';
    }
    if (ex.replace(/['"]/g, '') === ac.replace(/['"]/g, '')) {
        return ac.length > ex.length
            ? 'Your output has extra quote marks. <code>print(\'x\')</code> shows <code>x</code> without quotes, so the quotes are probably inside the string, or you are printing a list of strings.'
            : 'The expected output includes quote marks, yours does not. Printing a list keeps the quotes around strings.';
    }
    if (ex.replace(/[^\w\s]/g, '') === ac.replace(/[^\w\s]/g, '')) return 'Only the punctuation differs. Check full stops, commas, colons and exclamation marks.';
    if (/^-?\d+$/.test(ac) && /^-?\d+\.\d+$/.test(ex) && Number(ac) === Number(ex)) return 'Expected a decimal, got a whole number. In Python <code>/</code> always gives a float like <code>5.0</code>, while <code>//</code> gives an int.';
    if (/^-?\d+\.\d+$/.test(ac) && /^-?\d+$/.test(ex) && Number(ac) === Number(ex)) return 'Expected a whole number, got a decimal. Use <code>//</code> for whole-number division, or <code>int()</code> to convert.';
    if (e.length !== a.length) return `Expected ${e.length} line${e.length === 1 ? '' : 's'}, your output has ${a.length}. The rows in red show where they drift apart.`;
    const firstBad = e.findIndex((l, i) => l !== a[i]);
    if (firstBad >= 0) return `The first difference is on line ${firstBad + 1}.`;
    return '';
}

/* =========================================================
   Progress UI hooks
   ========================================================= */

function markComplete(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = 'completed';
    const card = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
    if (card) {
        card.classList.add('is-done', 'flash');
        card.querySelector('.task-check').checked = true;
        setTimeout(() => card.classList.remove('flash'), 800);
    }
    updateTaskStatus(taskId, 'completed');
    updateTaskCount();
    updateDoneBox();
}

function applyStats(stats) {
    const pct = Math.round(stats.percentage || 0);
    el.progressBar.style.width = pct + '%';
    el.progressText.textContent = pct + '%';
    $('progressWrap').title = `${stats.completed} of ${stats.total} tasks finished across the course`;
    const streak = stats.streak || 0;
    el.streakBadge.hidden = streak < 2;
    el.streakCount.textContent = streak;
}

/* =========================================================
   Overview dialog
   ========================================================= */

function openOverview() {
    refreshDayCompletion();
    const stats = getStats(state.totalTasks);
    applyStats(stats);

    const daysDone = state.days.filter(d => d.total && d.completed === d.total).length;
    el.overviewSummary.textContent = `${stats.completed} of ${stats.total} tasks finished · ${daysDone} of ${state.days.length} days complete`;

    el.overviewList.innerHTML = state.days.map(d => {
        const pct = d.total ? Math.round(d.completed / d.total * 100) : 0;
        const cls = ['overview-row', d.day === state.day ? 'is-current' : '', d.total && d.completed === d.total ? 'is-done' : ''].filter(Boolean).join(' ');
        return `<button class="${cls}" data-day="${d.day}">
            <span class="ov-day">${pad2(d.day)}</span>
            <span class="ov-title">${escapeHtml(d.title)}</span>
            <span class="ov-track"><span class="ov-fill" style="width:${pct}%"></span></span>
            <span class="ov-count">${d.completed}/${d.total}</span>
        </button>`;
    }).join('');

    el.overviewList.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
        closeOverview();
        goToDay(Number(b.dataset.day));
    }));

    el.overviewOverlay.hidden = false;
    el.overviewList.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
}

function closeOverview() { el.overviewOverlay.hidden = true; }

/* =========================================================
   Reference drawer
   ========================================================= */

async function openReference() {
    if (!state.reference) {
        try { state.reference = await api('data/reference.json'); }
        catch (err) { console.error(err); showToast('Could not load the reference.'); return; }
    }
    renderReference(el.referenceSearch.value);
    el.referenceDrawer.hidden = false;
    el.drawerBackdrop.hidden = false;
    setTimeout(() => el.referenceSearch.focus(), 0);
}

function closeReference() {
    el.referenceDrawer.hidden = true;
    el.drawerBackdrop.hidden = true;
}

function renderReference(query) {
    const q = (query || '').trim().toLowerCase();
    const sections = (state.reference?.sections || []).map(sec => {
        const items = sec.items.filter(it => !q || (it.code + ' ' + it.note + ' ' + sec.title).toLowerCase().includes(q));
        return { ...sec, items };
    }).filter(sec => sec.items.length);

    if (!sections.length) {
        el.referenceBody.innerHTML = '<p class="ref-empty">Nothing matches that. Try a shorter word.</p>';
        return;
    }
    const mark = (text) => {
        const safe = escapeHtml(text);
        if (!q) return safe;
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return safe.replace(re, m => `<mark>${m}</mark>`);
    };
    el.referenceBody.innerHTML = sections.map(sec => `
        <details class="ref-section" open>
            <summary>${escapeHtml(sec.title)}</summary>
            ${sec.items.map(it => `<div class="ref-item"><pre>${mark(it.code)}</pre><span>${mark(it.note)}</span></div>`).join('')}
        </details>`).join('');
}

/* =========================================================
   Menu, hotkeys, reset
   ========================================================= */

function openMenu() {
    const r = el.menuBtn.getBoundingClientRect();
    el.menuPanel.style.top = (r.bottom + 6) + 'px';
    el.menuPanel.style.right = (window.innerWidth - r.right) + 'px';
    el.menuPanel.hidden = false;
}
function closeMenu() { el.menuPanel.hidden = true; }

async function resetProgress() {
    const ok = await askConfirm({
        title: 'Reset all progress?',
        body: 'Every task will be marked as not done and your streak goes back to zero. The code in your editor is kept. This cannot be undone.',
        okLabel: 'Reset everything',
        danger: true,
    });
    if (!ok) return;
    resetProgressData();
    location.reload();
}

/* ---------- bracket hotkeys ---------- */

function loadHotkeys() {
    const stored = loadJson(KEYS.hotkeys, null);
    return Array.isArray(stored) && stored.length ? stored : DEFAULT_HOTKEYS.map(h => ({ ...h }));
}

function buildMonacoKeybinding(hk) {
    let mod = 0;
    if (hk.shift) mod |= monaco.KeyMod.Shift;
    if (hk.ctrl)  mod |= monaco.KeyMod.CtrlCmd;
    if (hk.alt)   mod |= monaco.KeyMod.Alt;
    const keyCode = monaco.KeyCode['Key' + hk.key.toUpperCase()] ?? monaco.KeyCode['Digit' + hk.key];
    return keyCode != null ? (mod | keyCode) : null;
}

function formatHotkeyLabel(hk) {
    const parts = [];
    if (hk.ctrl)  parts.push('Ctrl');
    if (hk.alt)   parts.push('Alt');
    if (hk.shift) parts.push('Shift');
    parts.push(hk.key.toUpperCase());
    return parts.join(' + ');
}

function registerEditorHotkeys() {
    if (!state.editor) return;
    state.hotkeyDisposables.forEach(d => d.dispose());
    state.hotkeyDisposables.length = 0;
    loadHotkeys().forEach(hk => {
        const kb = buildMonacoKeybinding(hk);
        if (kb === null) return;
        try {
            const d = state.editor.addAction({
                id: `bracket-pair-${hk.id}-${++state.hotkeyCounter}`,
                label: `Insert ${hk.pair}`,
                keybindings: [kb],
                run: () => insertBracketPair(hk.pair[0], hk.pair[1]),
            });
            state.hotkeyDisposables.push(d);
        } catch (_) {}
    });
}

function insertBracketPair(open, close) {
    const ed = state.editor;
    if (!ed) return;
    const sel = ed.getSelection();
    const selected = ed.getModel().getValueInRange(sel);
    if (selected) {
        ed.executeEdits('bracket-hotkey', [{ range: sel, text: open + selected + close, forceMoveMarkers: true }]);
    } else {
        ed.executeEdits('bracket-hotkey', [{ range: sel, text: open + close, forceMoveMarkers: true }]);
        const pos = ed.getPosition();
        ed.setPosition({ lineNumber: pos.lineNumber, column: pos.column - 1 });
    }
    ed.focus();
}

function openHotkeyPanel() {
    const r = el.menuBtn.getBoundingClientRect();
    el.hotkeyPanel.style.top = (r.bottom + 6) + 'px';
    el.hotkeyPanel.style.right = (window.innerWidth - r.right) + 'px';
    renderHotkeyPanel();
    el.hotkeyPanel.hidden = false;
}

function closeHotkeyPanel() {
    if (state.captureCanceller) state.captureCanceller();
    el.hotkeyPanel.hidden = true;
}

function renderHotkeyPanel() {
    const hotkeys = loadHotkeys();
    el.hotkeyPanel.innerHTML = `
        <h3>Bracket shortcuts</h3>
        <div class="sub">Click a binding, then press the keys you want.</div>
        ${hotkeys.map(hk => `<div class="hotkey-row"><span class="hotkey-pair">${escapeHtml(hk.pair)}</span><button class="hotkey-bind" data-id="${hk.id}">${escapeHtml(formatHotkeyLabel(hk))}</button></div>`).join('')}
        <p class="help">Each one inserts the pair at the cursor, or wraps whatever you have selected. Handy on keyboards where brackets are awkward to reach.</p>
        <div class="popover-foot"><button data-reset>Back to defaults</button><button data-close>Close</button></div>`;

    el.hotkeyPanel.querySelectorAll('.hotkey-bind').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        startKeyCapture(b.dataset.id, b);
    }));
    el.hotkeyPanel.querySelector('[data-reset]').addEventListener('click', () => {
        try { localStorage.removeItem(KEYS.hotkeys); } catch (_) {}
        registerEditorHotkeys();
        renderHotkeyPanel();
    });
    el.hotkeyPanel.querySelector('[data-close]').addEventListener('click', closeHotkeyPanel);
}

function startKeyCapture(hkId, bindBtn) {
    if (state.captureCanceller) state.captureCanceller();
    bindBtn.textContent = 'press keys…';
    bindBtn.classList.add('capturing');

    function onKey(e) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        cleanup();
        const key = e.key.toLowerCase();
        if (/^[a-z0-9]$/.test(key)) {
            const hotkeys = loadHotkeys();
            const hk = hotkeys.find(h => h.id === hkId);
            if (hk) {
                hk.shift = e.shiftKey; hk.ctrl = e.ctrlKey; hk.alt = e.altKey; hk.key = key;
                store(KEYS.hotkeys, hotkeys);
                registerEditorHotkeys();
            }
        }
        renderHotkeyPanel();
    }
    function cleanup() {
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('blur', onBlur);
        state.captureCanceller = null;
    }
    function onBlur() { cleanup(); renderHotkeyPanel(); }

    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    state.captureCanceller = cleanup;
}

/* =========================================================
   Dialogs
   ========================================================= */

function buildDialog(innerHtml, { wide = false } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const dialog = document.createElement('div');
    dialog.className = 'dialog' + (wide ? ' dialog-wide' : '');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = innerHtml;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    return { overlay, dialog };
}

function askConfirm({ title, body, okLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
        const { overlay, dialog } = buildDialog(`
            <div class="dialog-head"><h2>${escapeHtml(title)}</h2></div>
            <div class="dialog-body">${body}</div>
            <div class="dialog-actions">
                ${cancelLabel ? `<button class="btn btn-quiet" data-cancel>${escapeHtml(cancelLabel)}</button>` : ''}
                <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(okLabel)}</button>
            </div>`);
        const finish = (v) => { overlay.remove(); resolve(v); };
        dialog.querySelector('[data-ok]').addEventListener('click', () => finish(true));
        dialog.querySelector('[data-cancel]')?.addEventListener('click', () => finish(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
        overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(false); });
        setTimeout(() => dialog.querySelector('[data-ok]').focus(), 0);
    });
}

/* =========================================================
   Wiring
   ========================================================= */

function bindUi() {
    el.runBtn.addEventListener('click', runCode);

    el.clearBtn.addEventListener('click', () => {
        if (!state.editor) return;
        resetEditorToStarter();
        state.editor.focus();
        clearOutput();
        showToast('Editor cleared. Ctrl+Z brings it back.');
    });

    el.daySelect.addEventListener('change', (e) => goToDay(Number(e.target.value)));
    el.prevDayBtn.addEventListener('click', () => stepDay(-1));
    el.nextDayBtn.addEventListener('click', () => stepDay(1));

    document.querySelectorAll('.side-tab').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
    el.lessonView.addEventListener('click', (e) => {
        if (e.target.closest('[data-go-tasks]')) setTab('tasks', { scrollTop: true });
    });

    el.overviewBtn.addEventListener('click', openOverview);
    el.overviewOverlay.addEventListener('click', (e) => {
        if (e.target === el.overviewOverlay || e.target.closest('[data-close]')) closeOverview();
    });

    el.referenceBtn.addEventListener('click', () => (el.referenceDrawer.hidden ? openReference() : closeReference()));
    el.referenceDrawer.querySelector('[data-close]').addEventListener('click', closeReference);
    el.drawerBackdrop.addEventListener('click', closeReference);
    el.referenceSearch.addEventListener('input', () => renderReference(el.referenceSearch.value));

    el.resetBtn.addEventListener('click', resetProgress);

    el.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeHotkeyPanel();
        el.menuPanel.hidden ? openMenu() : closeMenu();
    });
    el.menuHotkeys.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); openHotkeyPanel(); });

    document.addEventListener('click', (e) => {
        if (!el.menuPanel.hidden && !el.menuPanel.contains(e.target) && e.target !== el.menuBtn) closeMenu();
        if (!el.hotkeyPanel.hidden && !el.hotkeyPanel.contains(e.target) && !el.menuBtn.contains(e.target)) closeHotkeyPanel();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMenu(); closeHotkeyPanel(); closeOverview(); closeReference();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            // The editor binds its own Ctrl+Enter; only handle it when focus is elsewhere.
            if (document.querySelector('.overlay') || e.target.closest('.monaco-editor')) return;
            e.preventDefault();
            runCode();
        }
    });
}
