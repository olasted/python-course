"""
Turns a raw Python traceback into something a beginner can act on.

explain(stderr, script_path) -> dict | None
    {
        'type':        'NameError',
        'message':     "name 'nam' is not defined",
        'line':        3,                # line in the learner's code, if known
        'title':       "Python doesn't know what 'nam' is",
        'explanation': "...",            # one short paragraph
        'fixes':       ["...", "..."],   # concrete things to try
        'traceback':   "...",            # original text with the temp path hidden
    }
"""

import os
import re

_FRAME_RE = re.compile(r'File "(?P<path>[^"]+)", line (?P<line>\d+)')
_EXC_RE   = re.compile(r'^(?P<type>[A-Za-z_][\w.]*)(?::\s?(?P<msg>.*))?$')

_PY_NAMES = {
    'true':  "Python spells it `True` with a capital T.",
    'false': "Python spells it `False` with a capital F.",
    'none':  "Python spells it `None` with a capital N.",
    'null':  "Python doesn't have `null`. The 'nothing' value is `None`.",
    'string': "There's no `string` type. Use `str`, e.g. `str(42)`.",
    'integer': "The whole-number type is `int`, e.g. `int('42')`.",
    'printf': "Python prints with `print()`, not `printf`.",
    'println': "Python prints with `print()`. Each call already ends the line.",
    'console': "There's no `console` object. Just call `print(...)`.",
    'echo': "Python prints with `print()`, not `echo`.",
    'lenght': "Looks like a typo of `len`.",
    'lengh': "Looks like a typo of `len`.",
    'length': "Python uses `len(thing)`, not `length`.",
    'pi': "`pi` lives in the math module: `import math` then `math.pi`, or `from math import pi`.",
    'sqrt': "`sqrt` lives in the math module: `import math` then `math.sqrt(x)`.",
    'random': "You need `import random` at the top before using it.",
    'math': "You need `import math` at the top before using it.",
    'json': "You need `import json` at the top before using it.",
    'os': "You need `import os` at the top before using it.",
    'sys': "You need `import sys` at the top before using it.",
    're': "You need `import re` at the top before using it.",
    'time': "You need `import time` at the top before using it.",
    'datetime': "You need `from datetime import datetime` (or `import datetime`) first.",
    'date': "You need `from datetime import date` first.",
    'Counter': "You need `from collections import Counter` first.",
    'defaultdict': "You need `from collections import defaultdict` first.",
    'namedtuple': "You need `from collections import namedtuple` first.",
    'deque': "You need `from collections import deque` first.",
    'dataclass': "You need `from dataclasses import dataclass` first.",
    'field': "You need `from dataclasses import dataclass, field` first.",
    'reduce': "You need `from functools import reduce` first.",
    'partial': "You need `from functools import partial` first.",
    'asyncio': "You need `import asyncio` at the top before using it.",
    'threading': "You need `import threading` at the top before using it.",
    'csv': "You need `import csv` at the top before using it.",
    'sqlite3': "You need `import sqlite3` at the top before using it.",
    'logging': "You need `import logging` at the top before using it.",
    'unittest': "You need `import unittest` at the top before using it.",
    'Path': "You need `from pathlib import Path` first.",
    'ABC': "You need `from abc import ABC, abstractmethod` first.",
    'abstractmethod': "You need `from abc import ABC, abstractmethod` first.",
    'Protocol': "You need `from typing import Protocol` first.",
    'List': "You need `from typing import List` first (or just use the built-in `list`).",
    'Optional': "You need `from typing import Optional` first.",
    'Dict': "You need `from typing import Dict` first (or just use the built-in `dict`).",
    'Union': "You need `from typing import Union` first.",
    'TypeVar': "You need `from typing import TypeVar` first.",
    'contextmanager': "You need `from contextlib import contextmanager` first.",
    'timedelta': "You need `from datetime import timedelta` first.",
    'requests': "You need `import requests` at the top (and `pip install requests` once in a terminal).",
}

_MISSING_METHOD = {
    ('list', 'push'):     "Lists use `.append(item)` to add to the end.",
    ('list', 'add'):      "Lists use `.append(item)`. It's sets that use `.add()`.",
    ('list', 'length'):   "Use `len(my_list)` to get the size. It's a function, not a method.",
    ('list', 'size'):     "Use `len(my_list)` to get the size.",
    ('list', 'contains'): "Use the `in` keyword: `item in my_list`.",
    ('list', 'join'):     "`join` belongs to strings: `', '.join(my_list)`.",
    ('list', 'split'):    "`split` belongs to strings, not lists.",
    ('list', 'upper'):    "`upper` belongs to strings. Maybe you meant one item, like `my_list[0].upper()`?",
    ('list', 'keys'):     "`keys()` is for dictionaries. A list has no keys, only positions.",
    ('list', 'items'):    "`items()` is for dictionaries.",
    ('str', 'append'):    "Strings can't be appended to. Build a new one: `text = text + more` or use an f-string.",
    ('str', 'push'):      "Strings can't be pushed to. Build a new one with `+` or an f-string.",
    ('str', 'length'):    "Use `len(text)` to get the length.",
    ('str', 'size'):      "Use `len(text)` to get the length.",
    ('str', 'contains'):  "Use the `in` keyword: `'x' in text`.",
    ('str', 'reverse'):   "Strings don't have reverse. Use slicing: `text[::-1]`.",
    ('str', 'sort'):      "Strings can't be sorted in place. Try `''.join(sorted(text))`.",
    ('str', 'add'):       "Join strings with `+` or an f-string.",
    ('str', 'toUpperCase'): "Python calls it `.upper()`.",
    ('str', 'toLowerCase'): "Python calls it `.lower()`.",
    ('str', 'trim'):      "Python calls it `.strip()`.",
    ('str', 'substring'): "Use slicing: `text[start:end]`.",
    ('str', 'charAt'):    "Use indexing: `text[i]`.",
    ('str', 'indexOf'):   "Python calls it `.find()` (returns -1 if missing) or `.index()`.",
    ('str', 'replaceAll'): "Python's `.replace(old, new)` already replaces every occurrence.",
    ('str', 'decode'):    "Regular strings are already text. `.decode()` is for bytes.",
    ('dict', 'append'):   "Add to a dictionary with `my_dict[key] = value`.",
    ('dict', 'push'):     "Add to a dictionary with `my_dict[key] = value`.",
    ('dict', 'add'):      "Add to a dictionary with `my_dict[key] = value`.",
    ('dict', 'has_key'):  "Use the `in` keyword: `key in my_dict`.",
    ('dict', 'sort'):     "Dictionaries can't be sorted in place. Use `sorted(my_dict.items())`.",
    ('dict', 'length'):   "Use `len(my_dict)`.",
    ('dict', 'iteritems'): "In modern Python it's just `.items()`.",
    ('set', 'append'):    "Sets use `.add(item)`, not append.",
    ('set', 'push'):      "Sets use `.add(item)`.",
    ('set', 'sort'):      "Sets have no order. Use `sorted(my_set)` to get a sorted list.",
    ('tuple', 'append'):  "Tuples can't be changed after creation. Use a list if you need to add items.",
    ('tuple', 'sort'):    "Tuples can't be sorted in place. Use `sorted(my_tuple)`.",
    ('int', 'append'):    "This variable holds a number, not a list. Check where it was assigned.",
    ('float', 'append'):  "This variable holds a number, not a list. Check where it was assigned.",
    ('NoneType', None):   "The value is `None`. That often happens when you assign the result of `.sort()`, `.append()`, `random.shuffle()` or a function with no `return`. Those return nothing.",
    ('function', None):   "You're using a function without calling it. Add parentheses: `name()`.",
    ('builtin_function_or_method', None): "You're using a function without calling it. Add parentheses, e.g. `text.upper()` not `text.upper`.",
    ('method', None):     "You're using a method without calling it. Add parentheses.",
}


def _clean_traceback(stderr: str, script_path: str | None) -> str:
    text = stderr.rstrip()
    if script_path:
        text = text.replace(script_path, 'your code')
        base = os.path.basename(script_path)
        text = text.replace(base, 'your code')
    return text


def _user_line(stderr: str, script_path: str | None) -> int | None:
    frames = _FRAME_RE.findall(stderr)
    if not frames:
        return None
    if script_path:
        base = os.path.basename(script_path)
        mine = [int(ln) for path, ln in frames if path == script_path or path.endswith(base)]
        if mine:
            return mine[-1]
    return int(frames[-1][1])


def _exception_line(stderr: str) -> tuple[str, str] | None:
    for raw in reversed(stderr.strip().splitlines()):
        line = raw.strip()
        if not line or line.startswith(('File ', '^', 'During handling', 'The above exception', 'Traceback')):
            continue
        m = _EXC_RE.match(line)
        if m and (m.group('type').endswith(('Error', 'Exception', 'Warning', 'Exit', 'Interrupt', 'Iteration'))
                  or m.group('type') in ('KeyboardInterrupt', 'SystemExit', 'StopIteration', 'GeneratorExit')):
            return m.group('type'), (m.group('msg') or '').strip()
        break
    return None


def _q(name: str) -> str:
    return f'`{name}`'


def _explain(etype: str, msg: str) -> tuple[str, str, list[str]]:
    short = etype.split('.')[-1]
    m = msg

    # ---------- names ----------
    if short == 'NameError':
        name = _between(m, "name '", "'")
        title = f"Python doesn't know what {_q(name)} is" if name else "Python ran into a name it doesn't know"
        expl = ("You used a name that hasn't been created yet at this point in the program. "
                "That usually means a typo, a variable that's assigned further down, "
                "or text that was meant to be inside quotes.")
        fixes = []
        if name in _PY_NAMES:
            fixes.append(_PY_NAMES[name])
        elif name and name.lower() in _PY_NAMES:
            fixes.append(_PY_NAMES[name.lower()])
        fixes += [
            f"Check the spelling of {_q(name)} against where you created it." if name else "Check the spelling.",
            f"If {_q(name)} was meant to be text, put quotes around it." if name else "If it was meant to be text, put quotes around it.",
            "Make sure the line that creates it runs before this line.",
        ]
        return title, expl, fixes

    if short == 'UnboundLocalError':
        name = _between(m, "variable '", "'")
        return (
            f"{_q(name)} is used before it has a value inside this function" if name else "A variable is used before it has a value",
            ("Because you assign to this variable somewhere inside the function, Python treats it as a "
             "local variable for the whole function. Then it's read before that assignment happens."),
            ["If you meant the variable from outside the function, put `global name` as the first line of the function.",
             "Otherwise, give it a starting value at the top of the function before you use it."],
        )

    # ---------- syntax / indentation ----------
    if short == 'IndentationError' or short == 'TabError':
        if 'expected an indented block' in m:
            after = _between(m, "after '", "'")
            return (
                "The next line needs to be indented",
                (f"A line ending with a colon (like {_q(after)}) starts a block, and every line inside that block "
                 "must be indented by the same amount. Python found nothing indented underneath it."
                 if after else
                 "A line ending with a colon starts a block, and the lines inside must be indented. Python found nothing indented underneath it."),
                ["Indent the line(s) that belong inside the block by 4 spaces.",
                 "If the block is intentionally empty for now, write `pass` on an indented line."],
            )
        if 'unexpected indent' in m:
            return (
                "This line is indented but shouldn't be",
                "Python only expects indentation directly after a line ending with a colon. This line has extra spaces at the start that nothing above it explains.",
                ["Remove the spaces at the start of the line so it lines up with the code above it.",
                 "If it's meant to be inside an `if`, `for`, `def` etc., make sure that line ends with a colon."],
            )
        if 'unindent does not match' in m:
            return (
                "The indentation on this line doesn't line up with anything",
                "Python groups lines by how far they're indented. This line is indented by an amount that doesn't match any block above it.",
                ["Make each block use exactly the same indentation, usually 4 spaces.",
                 "Check for a mix of tabs and spaces. Pick one and stick to it."],
            )
        if short == 'TabError':
            return (
                "Tabs and spaces are mixed together",
                "Some lines are indented with tabs and others with spaces. They look the same but Python treats them differently.",
                ["Re-indent the block using only spaces (4 per level).",
                 "Most editors have a 'convert tabs to spaces' option."],
            )
        return ("Indentation problem", "Python couldn't work out how your lines are grouped.", ["Use exactly 4 spaces for every level of indentation."])

    if short == 'SyntaxError':
        if 'was never closed' in m:
            mm = re.match(r"^'(.+?)' was never closed", m)
            ch = mm.group(1) if mm else ''
            return (
                f"An opening {_q(ch)} was never closed" if ch else "A bracket or quote was never closed",
                "Every opening bracket or quote needs a matching closing one. Python got to the end without finding it. The line number points at where it was opened.",
                ["Count the opening and closing brackets on that line.",
                 "If a string starts with a quote, make sure it ends with the same kind of quote."],
            )
        if 'unterminated string' in m or 'EOL while scanning' in m:
            return (
                "A string was opened but never closed",
                "A quote mark starts a string and Python got to the end of the line without seeing the matching closing quote.",
                ["Add the missing closing quote.",
                 "If the text itself contains a quote, use the other kind on the outside: `\"it's\"`."],
            )
        if 'unterminated triple-quoted' in m:
            return ("A triple-quoted string was never closed", "A `\"\"\"` or `'''` opens a multi-line string. Python never found the closing one.", ["Add the closing triple quotes."])
        if "expected ':'" in m:
            return (
                "This line needs a colon at the end",
                "Lines that start a block (`if`, `elif`, `else`, `for`, `while`, `def`, `class`, `try`, `except`, `with`) must end with `:`.",
                ["Add a `:` at the end of the line."],
            )
        if 'unmatched' in m:
            ch = _between(m, "'", "'")
            return (
                f"There's a closing {_q(ch)} with no opening one" if ch else "There's a closing bracket with nothing to match",
                "Python found a closing bracket that doesn't pair with anything opened earlier.",
                ["Remove the extra bracket, or add the missing opening one."],
            )
        if 'Perhaps you forgot a comma' in m:
            return (
                "Two values are next to each other with nothing between them",
                "Inside brackets, items need commas between them. Python found two things side by side.",
                ["Add a comma between the items.",
                 "If you meant to join two strings, use `+` between them."],
            )
        if "Maybe you meant '=='" in m or 'cannot assign to' in m or 'invalid syntax. Maybe you meant' in m:
            return (
                "A single `=` is in a place that needs `==`",
                "One `=` assigns a value. Two `==` compare two values. Inside an `if` or `while` you almost always want `==`.",
                ["Change `=` to `==` in the condition."],
            )
        if 'unexpected EOF' in m or 'unexpected end of file' in m:
            return (
                "The code ends before Python expected it to",
                "Python was still waiting for something, usually a closing bracket, a closing quote, or the body of a block.",
                ["Check that every `(`, `[`, `{` and quote has a matching closer.",
                 "If the last line ends with a colon, add the indented block beneath it."],
            )
        if "'return' outside function" in m:
            return ("`return` is only allowed inside a function", "`return` sends a value back from a `def` function. It doesn't mean anything at the top level of a script.", ["Move the `return` inside a function, or use `print()` if you just want to see the value."])
        if "'break' outside loop" in m or "'continue' not properly in loop" in m:
            return ("`break`/`continue` only work inside a loop", "These two keywords control a `for` or `while` loop. This one isn't inside a loop.", ["Move it inside the loop body, or use a different way to stop (like `return` in a function)."])
        if 'invalid decimal literal' in m or 'invalid character' in m:
            return (
                "A name or number here isn't written in a way Python allows",
                "This often happens when a name starts with a digit (like `2nd`), when a number is glued to a word (`5x`), or when a curly quote or other odd character got pasted in.",
                ["Names must start with a letter or underscore.",
                 "Write multiplication explicitly: `5 * x`.",
                 "Retype any quotes by hand using straight ' or \" characters."],
            )
        if 'Missing parentheses in call to' in m:
            fn = _between(m, "call to '", "'")
            return (f"{_q(fn)} needs parentheses", f"In modern Python, {_q(fn)} is a function, so what you print goes inside brackets.", [f"Write `{fn}(...)` with the value inside the parentheses."])
        if 'invalid syntax' in m:
            return (
                "Something on this line isn't valid Python",
                "Python couldn't read this line. The most common causes are a missing colon, a missing or extra bracket, a missing comma, a stray quote, or using a word Python reserves (like `class` or `def`) as a variable name.",
                ["Read the line slowly from left to right and check every bracket, quote and colon.",
                 "The problem is sometimes on the line above, e.g. an unclosed bracket."],
            )
        if 'positional argument follows keyword argument' in m:
            return ("Arguments are in the wrong order", "Plain values must come before `name=value` arguments in a call.", ["Move the plain arguments first: `f(1, 2, x=3)`."])
        if 'f-string' in m:
            return ("Problem inside an f-string", "Something between the `{}` in an f-string isn't valid, or the quotes clash with the ones around the string.", ["Use different quotes inside the braces than around the string: `f\"{d['key']}\"`.", "Check every `{` has a matching `}`."])
        return ("Python couldn't read this line", "There's a syntax problem here: something is missing, extra, or in the wrong place.", ["Check brackets, quotes, commas and colons on this line and the one above."])

    # ---------- types ----------
    if short == 'TypeError':
        if 'can only concatenate str' in m or ('unsupported operand' in m and 'str' in m and '+' in m):
            return (
                "You're adding text and a number together",
                "`+` joins two strings or adds two numbers, but it can't mix them. One side is a `str` and the other isn't. Remember that `input()` always gives you a string.",
                ["Turn the number into text: `'Age: ' + str(age)`.",
                 "Or use an f-string, which handles it for you: `f'Age: {age}'`.",
                 "If you wanted maths, convert the text first: `int(value)` or `float(value)`."],
            )
        if 'unsupported operand' in m:
            op  = _between(m, "for ", ":")
            return (
                f"The {_q(op)} operator doesn't work with these two types" if op else "This operator doesn't work with these types",
                f"Python can't apply {_q(op) if op else 'that operator'} to the values you gave it. Check what each side actually holds. `None` on one side usually means a function returned nothing.",
                ["Print both values (and `type()` of them) just before this line to see what they really are.",
                 "Convert with `int()`, `float()` or `str()` as needed."],
            )
        if 'not supported between instances' in m:
            return (
                "You're comparing two different kinds of value",
                "`<`, `>`, `<=`, `>=` only make sense between the same kind of thing. One of these is probably text from `input()` while the other is a number.",
                ["Convert the input first: `int(input(...))` or `float(input(...))`."],
            )
        if 'object is not subscriptable' in m:
            t = _between(m, "'", "'")
            if t == 'NoneType':
                return ("You're indexing a value that is `None`", "The thing you're using `[...]` on is `None`. Methods like `.sort()`, `.append()` and `random.shuffle()` change the list and return `None`, so `x = x.sort()` throws the list away.", ["Don't assign the result of `.sort()` or `.append()`. Call them on their own line.", "If it came from a function, make sure that function has a `return`."])
            if t == 'builtin_function_or_method' or t == 'function' or t == 'method':
                return ("You used `[ ]` where `( )` was needed", "It looks like a function or method was followed by square brackets. Calls use round brackets.", ["Change `name[...]` to `name(...)`, e.g. `nums.append(5)` not `nums.append[5]`."])
            return (
                f"You can't use `[...]` on a {_q(t)}" if t else "You can't index this value",
                f"Square brackets pick an item out of a list, string, tuple or dictionary. This value is a {_q(t) if t else 'different type'}, which has no items to pick from.",
                ["Check what the variable holds; maybe it was overwritten with a single number.",
                 "If you meant to call a function, use round brackets."],
            )
        if 'object is not callable' in m:
            t = _between(m, "'", "'")
            expl = ("Round brackets after a name mean 'call this function'. But this value isn't a function. "
                    "This often happens when a variable name shadows a built-in, like writing `print = 5` or `list = [1, 2]` earlier, "
                    "or when a number is written right before a bracket, like `2(3 + 4)`.")
            return (f"You're calling a {_q(t)} as if it were a function" if t else "This value isn't a function", expl,
                    ["Look for a variable named `list`, `str`, `print`, `input`, `sum`, `max` etc. and rename it.",
                     "Write multiplication explicitly: `2 * (3 + 4)`."])
        if 'missing' in m and 'required positional argument' in m:
            fn   = m.split('(')[0]
            args = _between(m, "argument", "") or ''
            names = re.findall(r"'(\w+)'", m)
            if names == ['self']:
                return (f"{_q(fn)} was called on the class instead of an object", "Methods need an object to work on. Calling `Dog.bark()` doesn't say which dog. You need to create one first.", ["Create an instance: `d = Dog(...)` then call `d.bark()`.", "If this method shouldn't need an object, mark it `@staticmethod`."])
            return (
                f"{_q(fn)} was called without everything it needs" if fn else "A function was called with too few arguments",
                f"The function expects {'a value for ' + ', '.join(_q(n) for n in names) if names else 'more arguments'} but the call didn't provide {'it' if len(names) == 1 else 'them'}.",
                ["Check the `def` line to see which arguments it takes, and pass one value for each.",
                 "If it's a method, remember Python fills in `self` for you; you supply the rest."],
            )
        if 'positional argument' in m and 'were given' in m or 'positional arguments but' in m:
            fn = m.split('(')[0]
            if 'takes 0 positional arguments but 1 was given' in m or 'takes 0 positional arguments' in m:
                return (f"{_q(fn)} doesn't accept `self`", "This looks like a method defined without `self` as its first parameter. When you call `obj.method()`, Python passes the object automatically, so the def line needs a slot for it.", ["Change `def method():` to `def method(self):`."])
            return (
                f"{_q(fn)} was given too many arguments" if fn else "Too many arguments were passed",
                "The number of values in the call doesn't match the number of parameters in the `def` line. In a class, forgetting `self` in the def line causes this too.",
                ["Compare the call with the `def` line and count the arguments.",
                 "If it's a method, make sure the first parameter is `self`."],
            )
        if 'takes no arguments' in m:
            return ("This class doesn't accept arguments yet", "You passed values when creating the object, but the class has no `__init__` method to receive them.", ["Add `def __init__(self, ...):` to the class and store the values with `self.name = name`."])
        if 'object is not iterable' in m or "is not iterable" in m:
            t = _between(m, "'", "'")
            if t == 'NoneType':
                return ("You're looping over `None`", "The thing after `in` is `None`. That usually means a function forgot to `return` its result, or you assigned the result of `.sort()` or `.append()`.", ["Add a `return` to the function.", "Don't assign the result of `.sort()` / `.append()`."])
            if t in ('int', 'float'):
                return (f"You can't loop over a single number", "`for x in 5:` doesn't mean 'five times'. Loops need a collection or a range.", ["Use `range(n)`: `for i in range(5):`."])
            return (f"You can't loop over a {_q(t)}" if t else "This value can't be looped over", "`for ... in` needs something with items: a list, string, range, dictionary, etc.", ["Check what the variable actually holds before the loop."])
        if 'does not support item assignment' in m:
            t = _between(m, "'", "'")
            if t == 'tuple':
                return ("Tuples can't be changed", "Once a tuple is created its items are fixed. That's the whole point of tuples.", ["Use a list if you need to change items: `[1, 2, 3]` instead of `(1, 2, 3)`.", "Or build a new tuple."])
            if t == 'str':
                return ("Strings can't be changed in place", "You can't replace a single character with `text[0] = 'x'`. Strings are immutable.", ["Build a new string: `text = 'x' + text[1:]` or use `.replace()`."])
            return (f"A {_q(t)} can't be changed this way" if t else "This value can't be changed this way", "Item assignment with `[...] = ` only works on lists and dictionaries.", ["Check the type of the variable."])
        if 'unhashable type' in m:
            t = _between(m, "'", "'")
            return (f"A {_q(t)} can't be used as a dictionary key or set item" if t else "This value can't be a dictionary key", "Keys and set items must be values that never change (strings, numbers, tuples). Lists and dicts can change, so they're not allowed.", ["Use a tuple instead of a list: `(1, 2)` not `[1, 2]`.", "Or use a string key."])
        if "has no len()" in m:
            t = _between(m, "'", "'")
            return (f"`len()` doesn't work on a {_q(t)}" if t else "`len()` doesn't work on this", "`len()` counts items in a collection (list, string, dict...). A number has no items.", ["Check what the variable holds. If it's a number you may want `len(str(n))` for its digit count."])
        if 'must be str, not' in m or 'expected str' in m:
            return ("This needs text but got something else", "A function that works on strings was handed a number (or `None`).", ["Wrap the value in `str(...)` or use an f-string."])
        if 'argument must be a string' in m or "int() argument must be" in m:
            return ("`int()` / `float()` was given something it can't convert", "These functions take a string or a number. They can't convert a list, `None`, or a dictionary.", ["Print the value first to see what you're actually passing in."])
        if 'got an unexpected keyword argument' in m:
            kw = _between(m, "argument '", "'")
            return (f"{_q(kw)} isn't a parameter this function knows about" if kw else "Unknown keyword argument", "You passed `name=value` but the function's `def` line has no parameter with that name.", ["Check the spelling of the parameter name against the def line."])
        if 'takes from' in m or 'takes at most' in m or 'expected at most' in m:
            return ("Wrong number of arguments", "The function was called with a different number of values than it accepts.", ["Look at the function's def line (or its docs) and match the count.", "`input()` takes at most one argument, the prompt text."])
        if "object of type" in m and "is not JSON serializable" in m:
            return ("This value can't be turned into JSON", "JSON only understands dicts, lists, strings, numbers, booleans and None. Custom objects, sets and dates need converting first.", ["Convert to a dict first, e.g. `vars(obj)` for a dataclass, or `list(my_set)`."])
        if "'>' not supported" in m or "'<' not supported" in m:
            return ("Comparing different kinds of value", "You can't compare text with a number.", ["Convert the text with `int()` or `float()` first."])
        if 'a bytes-like object is required' in m or "can't concat str to bytes" in m:
            return ("Bytes and text got mixed up", "Data read from a network or a binary file is `bytes`, not `str`.", ["Call `.decode()` on the bytes to turn them into text, e.g. `response.read().decode()`."])
        return ("A value is the wrong type for what you're doing with it", "Python is strict about types: text, numbers, lists and so on each support different operations.", ["Print `type(value)` for the values on this line to see what they really are.", "Convert with `int()`, `float()`, `str()`, or `list()` as appropriate."])

    # ---------- values ----------
    if short == 'JSONDecodeError':
        return ("This text isn't valid JSON",
                "JSON is stricter than Python: keys and strings need double quotes, there are no trailing commas, and it uses lowercase `true`, `false` and `null`.",
                ["Check the string you're passing to `json.loads()`. Use double quotes inside it.",
                 "If it comes from a file, make sure the file isn't empty."])
    if short == 'ValueError':
        if 'invalid literal for int()' in m:
            bad = _between(m, ": '", "'")
            if bad and re.fullmatch(r'-?\d+\.\d*', bad):
                return (f"`int()` can't read {_q(bad)} because it has a decimal point", "`int()` only accepts whole numbers written as text. For decimals you need `float()`.", ["Use `float(...)` instead, or `int(float(...))` to round down."])
            if bad == '':
                return ("`int()` was given an empty string", "Nothing was typed, so there's no number to convert. When you provide inputs, make sure each `input()` gets a value.", ["Check the input values you entered.", "Guard against it: `if text: num = int(text)`."])
            return (f"`int()` can't turn {_q(bad)} into a number" if bad else "`int()` was given text that isn't a number",
                    "`int()` only accepts digits (with an optional minus sign). Letters, spaces or symbols cause this error.",
                    ["Check what you're passing in. It's often the prompt text itself, like `int('Enter a number: ')`.",
                     "Use `.strip()` to remove spaces first.",
                     "To handle bad input gracefully, wrap it in `try:` / `except ValueError:`."])
        if 'could not convert string to float' in m:
            bad = _between(m, ": '", "'")
            return (f"`float()` can't turn {_q(bad)} into a number" if bad else "`float()` was given text that isn't a number", "`float()` accepts things like `'3.5'` or `'-2'`, but not words or empty text.", ["Check the value you're converting.", "Wrap it in `try:` / `except ValueError:` to handle bad input."])
        if 'not enough values to unpack' in m:
            exp = _between(m, "expected ", ",")
            got = _between(m, "got ", ")")
            return ("Not enough values to fill the variables", f"You wrote {exp or 'several'} variables on the left of `=`, but the right side only has {got or 'fewer'} items.", ["Match the number of variables to the number of items.", "Print the right-hand side to see exactly what it contains."])
        if 'too many values to unpack' in m:
            exp = _between(m, "expected ", ")")
            return ("Too many values for the variables", f"The right side of `=` has more items than the {exp or ''} variables on the left.", ["Match the counts, or catch the rest with a star: `first, *rest = items`."])
        if 'math domain error' in m:
            return ("That maths operation has no real answer", "For example, the square root of a negative number or the log of zero.", ["Check the number you're passing in. Is it negative when it shouldn't be?"])
        if 'is not in list' in m:
            return ("`.remove()` / `.index()` couldn't find that item", "The value isn't in the list, so there's nothing to remove or locate.", ["Check with `if item in my_list:` first.", "Remember it's case-sensitive."])
        if 'substring not found' in m:
            return ("`.index()` couldn't find that text", "The substring isn't in the string.", ["Use `.find()` instead, which returns -1 instead of crashing.", "Check the exact spelling and case."])
        if 'Expecting value' in m or 'Expecting property name' in m or 'Extra data' in m:
            return ("This text isn't valid JSON", "JSON is stricter than Python: it needs double quotes around keys and strings, no trailing commas, and `true`/`false`/`null` in lowercase.", ["Check the string you're passing to `json.loads()`. Use double quotes inside it.", "If it comes from a file, make sure the file isn't empty."])
        if 'empty separator' in m:
            return ("`.split('')` isn't allowed", "You can't split on an empty string. To get a list of characters use `list(text)`.", ["Use `list(text)` for individual characters."])
        if 'time data' in m and 'does not match format' in m:
            return ("The date text doesn't match the format you gave", "`strptime` needs the format string to describe the text exactly: same separators, same order.", ["Compare the text and the format side by side: `%Y-%m-%d` matches `2025-12-25`."])
        if 'I/O operation on closed file' in m:
            return ("The file is already closed", "You're reading or writing after the `with` block ended, and `with` closes the file automatically.", ["Move the read/write inside the indented `with` block."])
        return ("A value is the right type but not acceptable here", "The function understood the type of value you gave it but couldn't do anything sensible with that particular value.", ["Read the message above for the exact reason.", "Print the value just before this line to check it."])

    # ---------- everyday runtime errors ----------
    if short == 'ZeroDivisionError':
        return ("You divided by zero", "Somewhere on this line a number is being divided by `0` (or `%` by 0). Maths doesn't allow that, so Python stops.", ["Check the value of the divisor before dividing: `if b != 0:`.", "If the divisor comes from `len()` of a list, the list may be empty."])
    if short == 'IndexError':
        return ("You asked for a position that doesn't exist", "Positions start at 0, so a list with 3 items has positions 0, 1 and 2. Asking for position 3 (or higher) fails. It also happens when the list is empty.", ["The last item is `items[-1]` or `items[len(items) - 1]`.", "Print `len(items)` to see how many there really are.", "If you're looping with `range`, use `range(len(items))`."])
    if short == 'KeyError':
        key = m.strip()
        return (f"The dictionary has no key {key}" if key else "That key isn't in the dictionary",
                "You looked up a key with `d[key]` but the dictionary doesn't contain it. Keys are case-sensitive and `'1'` (text) is different from `1` (number).",
                ["Use `.get(key, default)` if the key might be missing.", "Check with `if key in d:` first.", "Print the dictionary's keys with `print(d.keys())`."])
    if short == 'AttributeError':
        t    = _between(m, "'", "'")
        attr = _between(m, "attribute '", "'")
        if t == 'NoneType':
            return (f"You're using `.{attr}` on something that is `None`" if attr else "You're using a method on `None`",
                    "The variable holds `None` instead of the value you expected. The usual causes: assigning the result of `.sort()`, `.append()` or `random.shuffle()` (they return `None`), or calling a function that has no `return`.",
                    ["Call `.sort()` / `.append()` on their own line, don't assign them.", "Make sure your function ends with `return ...`.", "Use `.get()` on dicts: it returns `None` when a key is missing."])
        if m.startswith('module'):
            mod = _between(m, "module '", "'")
            return (f"The {_q(mod)} module has nothing called {_q(attr)}" if mod and attr else "That module doesn't have that name",
                    "Either the name is misspelled, or your own file is named the same as the module (e.g. a file called `random.py` shadows the real `random`).",
                    [f"Check the spelling: `{mod}.{attr}`." if mod and attr else "Check the spelling.", "Run `print(dir(module))` to list what it actually contains."])
        if t == 'type' or m.startswith('type object'):
            cls = _between(m, "type object '", "'")
            return (f"The class {_q(cls)} has no {_q(attr)}" if cls and attr else "The class doesn't have that attribute", "You're accessing something on the class itself rather than on an object created from it. Attributes set in `__init__` only exist on instances.", ["Create an instance first: `obj = ClassName(...)` then `obj.attr`."])
        specific = _MISSING_METHOD.get((t, attr)) or _MISSING_METHOD.get((t, None))
        title = f"A {_q(t)} doesn't have anything called {_q(attr)}" if t and attr else "That attribute or method doesn't exist"
        expl  = "Each type has its own set of methods. This one isn't available on this type, or it's spelled differently."
        fixes = [specific] if specific else []
        fixes += ["Check the spelling and capitalisation of the method name.",
                  "Print `type(variable)` to confirm what you're working with."]
        return title, expl, fixes
    if short == 'ModuleNotFoundError':
        mod = _between(m, "No module named '", "'")
        fixes = []
        if mod in ('requests', 'numpy', 'pandas', 'flask', 'bs4', 'matplotlib'):
            fixes.append(f"This one isn't built in. Install it once from a terminal: `pip install {mod}`.")
        fixes += ["Check the spelling of the module name.", "If it's your own file, it must be in the same folder as the running script."]
        return (f"Python can't find a module called {_q(mod)}" if mod else "Python can't find that module", "`import` looks for a built-in module, an installed package, or a `.py` file next to your script. None matched.", fixes)
    if short == 'ImportError':
        name = _between(m, "cannot import name '", "'")
        return (f"There's nothing called {_q(name)} to import from that module" if name else "That import didn't work", "The module exists, but it doesn't contain a name with that spelling.", ["Check the spelling and capitalisation.", "Try `import module` then `print(dir(module))` to see what's inside."])
    if short == 'FileNotFoundError':
        fn = _between(m, "directory: '", "'")
        return (f"There's no file called {_q(fn)}" if fn else "That file doesn't exist",
                "Python looked in the working folder and didn't find it. In this course, files you create with `open(..., 'w')` are saved in the `src/workspace` folder, and only after that code has run.",
                ["Write the file first (with mode `'w'`) before reading it, in the same run.", "Check the spelling and the extension (`.txt`).", "To handle it gracefully: `try:` / `except FileNotFoundError:`."])
    if short == 'PermissionError':
        return ("Python isn't allowed to touch that file", "The operating system refused access. The file might be open in another program, or the path points at a folder.", ["Close the file in other programs and try again.", "Check that the path is a file, not a folder."])
    if short == 'IsADirectoryError':
        return ("That path is a folder, not a file", "`open()` needs a file path.", ["Add the file name to the end of the path."])
    if short == 'RecursionError':
        return ("The function keeps calling itself and never stops", "A recursive function needs a base case, a condition where it returns without calling itself again. Either that's missing, or each call isn't getting closer to it.", ["Add `if n <= 1: return ...` (or similar) at the top.", "Make sure the recursive call uses a smaller value, like `n - 1`."])
    if short == 'StopIteration':
        return ("The generator/iterator has run out of values", "`next()` was called one more time than there were items.", ["Give `next()` a default: `next(gen, None)`.", "Or loop with `for` instead, which stops on its own."])
    if short == 'AssertionError':
        return ("An `assert` check failed" + (f": {m}" if m else ""), "`assert` says 'this must be true'. It wasn't, so Python stopped. That's the test doing its job.", ["Look at what the assertion is checking and work out why the value differs.", "Print the actual value just before the assert."])
    if short == 'EOFError':
        return ("Your code asked for more input than was provided", "Each `input()` call needs a line of input. The program asked for one more than it was given.", ["Count the `input()` calls, including ones inside loops, and provide a value for each.", "If a loop asks until a certain value, make sure that value is in the inputs."])
    if short == 'KeyboardInterrupt':
        return ("The program was interrupted", "It was stopped from outside before finishing.", ["Run it again."])
    if short == 'OverflowError':
        return ("The number got too big", "The result is larger than Python's floats can represent.", ["Check for a loop or exponent that grows without limit."])
    if short == 'MemoryError':
        return ("The program ran out of memory", "Something is building an enormous list or string, most likely in a loop without a proper end.", ["Check loop conditions and anything that appends in a loop."])
    if short == 'FrozenInstanceError':
        return ("This dataclass is frozen, so it can't be changed", "`@dataclass(frozen=True)` makes objects read-only after creation.", ["Create a new object with the changed value, or remove `frozen=True`."])
    if short == 'OperationalError':
        if 'no such table' in m:
            return ("The database table doesn't exist yet", "You're querying a table before creating it, or the database file is a fresh one.", ["Run the `CREATE TABLE IF NOT EXISTS ...` statement first in the same script."])
        if 'already exists' in m:
            return ("That table already exists", "A previous run created it. `CREATE TABLE` fails if it's there already.", ["Use `CREATE TABLE IF NOT EXISTS ...`."])
        if 'syntax error' in m:
            return ("There's a mistake in the SQL", "The database couldn't parse the SQL text.", ["Check commas between columns and spelling of SQL keywords."])
        return ("Database error", m or "The database refused the operation.", ["Read the message above for the specific reason."])
    if short == 'IntegrityError':
        return ("The database rejected the data", "Usually a duplicate value in a PRIMARY KEY or UNIQUE column.", ["Let the database assign IDs, or check the value isn't already there."])
    if short == 'UnicodeEncodeError' or short == 'UnicodeDecodeError':
        return ("A character couldn't be encoded/decoded", "The text contains a character the chosen encoding can't handle.", ["Open files with `encoding='utf-8'`."])
    if short == 'TimeoutError':
        return ("The operation timed out", "It took longer than allowed.", ["Increase the timeout, or check whether the task really needs that long."])
    if short == 'URLError' or short == 'HTTPError' or short == 'ConnectionError' or short == 'gaierror':
        return ("The network request failed", "Python couldn't reach the server, or the server sent back an error status.", ["Check the URL and your internet connection.", "Wrap the request in `try:` / `except` so the program can report it nicely."])
    if short == 'SystemExit':
        return ("The program called `sys.exit()`", "That's a deliberate stop, not a bug." + (f" Exit code: {m}." if m else ""), ["If you didn't mean to exit here, remove the `sys.exit()` call."])
    if short == 'RuntimeError':
        if 'dictionary changed size during iteration' in m:
            return ("You changed a dictionary while looping over it", "Adding or removing keys inside a `for key in d:` loop isn't allowed.", ["Loop over a copy: `for key in list(d):`."])
        if 'asyncio.run() cannot be called from a running event loop' in m:
            return ("`asyncio.run()` was called inside async code", "It's meant to be the single entry point from normal code.", ["Inside an `async def`, use `await` instead of `asyncio.run()`."])
        if 'no running event loop' in m:
            return ("This needs to run inside `asyncio.run(...)`", "`create_task` and friends only work while an event loop is running.", ["Put the code inside an `async def main()` and call `asyncio.run(main())`."])
    if short == 'Exception' or short.endswith('Error'):
        return (f"{short}" + (f": {m}" if m else ""), "This error was raised deliberately in your code (or by a library) to signal a problem.", ["Read the message for the reason.", "If you raised it yourself on purpose, this is your code working as intended."])
    return (short + (f": {m}" if m else ""), "Python stopped because of this error.", ["Read the message and the line number, then check that line."])


def _between(text: str, start: str, end: str) -> str:
    i = text.find(start)
    if i < 0:
        return ''
    i += len(start)
    if end == '':
        return text[i:].strip()
    j = text.find(end, i)
    return text[i:j] if j >= 0 else text[i:]


def explain(stderr: str, script_path: str | None = None) -> dict | None:
    if not stderr or not stderr.strip():
        return None

    if stderr.startswith('Execution timed out'):
        return {
            'type': 'Timeout', 'message': stderr, 'line': None,
            'title': "Your program ran too long and was stopped",
            'explanation': ("It didn't finish within the time limit. Nine times out of ten that's a loop that never ends: "
                            "a `while` condition that never becomes False, or a counter that never changes."),
            'fixes': ["Check that something inside the `while` loop changes the condition each time, e.g. `i += 1`.",
                      "If you use `while True:`, make sure there's a `break` that can actually be reached.",
                      "If the program is waiting for `input()`, make sure you supplied enough input values."],
            'traceback': stderr,
        }

    parsed = _exception_line(stderr)
    if not parsed:
        return {
            'type': 'Error', 'message': stderr.strip().splitlines()[-1], 'line': _user_line(stderr, script_path),
            'title': "Something went wrong",
            'explanation': "Python stopped, but the message isn't in a form this helper recognises. The raw output below has the details.",
            'fixes': ["Read the last line of the output: it names the error and usually why it happened."],
            'traceback': _clean_traceback(stderr, script_path),
        }

    etype, msg = parsed
    title, expl, fixes = _explain(etype, msg)
    return {
        'type': etype,
        'message': msg,
        'line': _user_line(stderr, script_path),
        'title': title,
        'explanation': expl,
        'fixes': fixes,
        'traceback': _clean_traceback(stderr, script_path),
    }
