# Python Course

A 60-day, self-paced Python course that runs in your browser. Each day has a short
lesson, a handful of tasks, hints that get more specific one step at a time, and a
worked solution with an explanation. The app checks your output for you and explains
errors in plain language.

There are two ways to run it, built from the same course content:

| | `src/` (local) | `docs/` (static, GitHub Pages) |
|---|---|---|
| Runs | A small Flask server on your machine | Nothing — pure HTML/CSS/JS, no server at all |
| Runs your code with | A real local Python process | A real Python interpreter compiled to WebAssembly (Pyodide), inside your browser tab |
| Progress saved to | `src/progress.json` on disk | Your browser's `localStorage` — per browser, per device |
| Hosting | Your own machine | Free, forever, on GitHub Pages |
| Extra feature | Focus mode (blocks distracting sites, needs admin) | — not possible from a browser tab |
| Networking tasks (day 54) | Work normally | Don't work — see [Limitations](#limitations-of-the-static-build) |

Pick whichever fits: run it locally while you're editing the course, or put the
`docs/` build on GitHub Pages so you (or anyone) can open a link and start coding
with nothing to install.

## Running it locally

You need Python 3.10 or newer.

```
pip install -r requirements.txt
python src/app.py
```

Then open http://127.0.0.1:5000 in a browser. The editor and fonts load from a CDN,
so the first load needs an internet connection. Leave the terminal open while you use
it; `Ctrl+C` stops the server.

Files your programs create with `open()` are saved in `src/workspace`. Progress is
stored in `src/progress.json`; the **Reset** button clears it.

## Putting it on GitHub Pages (free hosting, no install)

The `docs/` folder is a complete, self-contained copy of the app that needs no server.
GitHub can serve it for free at a `https://<your-username>.github.io/<repo-name>/`
address.

1. **Create a repository and push this project.**
   ```
   git init
   git add .
   git commit -m "Python course"
   gh repo create <repo-name> --public --source=. --push
   ```
   (No `gh`? Create an empty repo on github.com instead, then
   `git remote add origin <the URL it gives you>` and `git push -u origin main`.)

2. **Turn on Pages.** On GitHub, open the repository → **Settings** → **Pages**. Under
   "Build and deployment", set **Source** to "Deploy from a branch", pick the `main`
   branch and the **`/docs`** folder, then **Save**.

3. **Wait a minute**, then visit the URL GitHub shows on that same Pages settings
   page. That's it — no build step, no keys, nothing to configure. Share that link
   with anyone; each visitor gets their own progress, saved in their own browser.

Whenever you edit a lesson, task or the reference sheet under `src/curriculum/`, run:

```
python tools/build_static.py
```

then commit and push. That script copies the course content (day files, reference
sheet, error explainer, stylesheet, logo) into `docs/`. It does **not** touch
`docs/index.html` or the two `docs/static/js/*.js` files — those hold the browser-only
app logic and are edited directly, separately from `src/`.

## Using it

- **Lesson tab** explains the day's idea with runnable examples. "Try it in the editor"
  drops an example into the editor.
- **Tasks tab** lists the day's tasks. Click one to make it the task you're working on,
  then write your code and press **Run** (or Ctrl+Enter).
- Tasks with a known answer are checked automatically. If the output isn't right you
  get a side-by-side comparison. Tasks marked "not checked automatically" are ones
  you tick off yourself.
- **Hint** reveals one nudge at a time. **Solution** shows one way to do it and how it
  works, and can add the code to your editor.
- When your code has an error, the output panel explains it in plain language and
  points at the line.
- **Overview** shows the whole course and your progress. **Reference** is a searchable
  cheat sheet. **Reset** wipes all progress and starts over.
- The theme button switches between light and dark.
- Code you write is saved in the browser per day, so switching days doesn't lose it.

## Limitations of the static build

The `docs/` build runs a genuine Python interpreter, so almost everything works
identically to the local version, with two differences worth knowing about:

- **The first "Run" of a visit takes a few seconds** while the browser downloads the
  Python runtime (a one-off ~10–25 MB, cached afterwards). The Run button reads
  "Loading Python…" until it's ready.
- **Day 54 (HTTP Requests) won't work.** Making real network requests from Python
  running inside a browser sandbox needs extra plumbing (a proxy or a service worker)
  that isn't set up here. Those tasks run fine in the local Flask version.
- **Focus mode isn't available.** It works by editing your machine's hosts file and
  firewall, which a browser tab can't do. It only appears in the local version.
- Progress lives in that one browser, on that one device. There's no account system,
  so it won't follow you to a different browser or computer.

## Editing the course

Each day is a JSON file in `src/curriculum/days`. A task looks like:

```json
{
  "id": "5.1",
  "description": "...",
  "hint": "First nudge\nSecond nudge\nThird nudge",
  "expected": "exact output, or empty if not auto-checked",
  "solution": "print('...')",
  "walkthrough": "One line per paragraph.",
  "solution_stdin": "optional sample answers for input(), one per line"
}
```

Each day also has a `lesson` with an `intro`, a list of `sections` (heading, body,
optional `code` and `output`) and a `watch_out` list. Backticks in text become inline
code. Blank lines separate paragraphs.

After editing, run the checker to make sure every solution still produces its
expected output, then rebuild `docs/`:

```
python tools/verify_solutions.py
python tools/build_static.py
```

## Focus mode

The local version's menu has a focus mode that blocks common AI and social sites by
editing the system hosts file and firewall. It only works when the server is started
from a terminal running as administrator, and it's entirely optional.
