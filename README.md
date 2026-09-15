# Python Course

A 60-day, self-paced Python course. Each day has a short lesson, tasks with hints
that get more specific, and a worked solution. The app checks your output and
explains errors in plain language.

**Try it now:** **https://dna0102.github.io/python-course/**

Nothing to install — a real Python interpreter runs inside the page, and your
progress saves to your browser automatically.

## Running it locally instead

```
pip install -r requirements.txt
python src/app.py
```

Open http://127.0.0.1:5000. This version uses a small Flask server, saves progress
to `src/progress.json`, and has one extra feature the hosted version can't: a
focus mode that blocks distracting sites (needs admin rights).

## Two builds, one set of content

- `src/` — the local Flask app above.
- `docs/` — the static build behind the live link above. No server: code runs via
  Pyodide (Python compiled to WebAssembly) in the browser, and progress lives in
  each visitor's own `localStorage`.

Edit lessons and tasks under `src/curriculum/days`. Each task has a description,
hint, expected output, solution and walkthrough — see any existing day file for
the shape. After editing, run:

```
python tools/verify_solutions.py   # checks every solution still passes
python tools/build_static.py       # copies the content into docs/
```

then commit and push. GitHub Pages picks up `docs/` automatically.

## Limitations of the hosted version

- The first run each visit takes a few seconds while Python loads (cached after that).
- Day 54 (HTTP Requests) doesn't work — it needs real networking that Pyodide can't
  do in a browser sandbox. Works fine locally.
- No focus mode — a browser tab can't edit your hosts file.
- Progress is per browser and device, with no accounts.
