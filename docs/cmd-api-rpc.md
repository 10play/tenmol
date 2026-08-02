# The `cmd` API, and the RPC contract over it

Map of PyMOL's `cmd` surface: what it contains, how command strings are parsed, how feedback
escapes, what the two bundled RPC servers do, and what the C++ core can and cannot notify about.
Every claim carries a `file:line` out of `packages/engine/`, which is unmodified upstream.
Where an API does **not** exist, it is called out explicitly as **DOES NOT EXIST**.

Deployment: one local PyMOL process, one browser client, loopback only, full filesystem access.

**Where the port stands.** The bridge described in §8 is built:
`packages/bridge/tenmol_bridge/` (`server.py` transport, `session.py` envelope, `dispatch.py`
resolution, `policy/` capability grants, `pump.py` the engine thread, `codec.py`, `blobs.py`,
`feedback.py`). The wire types are `packages/protocol/src/envelope.ts` +
`packages/protocol/src/topics/`; the generated API descriptor of §9 is
`packages/protocol/src/generated/api.ts`; the client is `packages/client/src/`.

---

## 1. What the `cmd` API surface actually is

### 1.1 `packages/engine/modules/pymol/api.py` — the public Python API

`api.py` is a pure re-export manifest. It contains **no function definitions**, only
`from .<module> import a, b, c` blocks (`packages/engine/modules/pymol/api.py:4-489`). `cmd.py` does
`from .api import *` (`packages/engine/modules/pymol/cmd.py:319`), which is what makes `cmd.load`,
`cmd.get_view`, etc. exist.

Measured by AST-parsing `api.py`: **404 unique symbols** (405 import entries, `mpng` appears
twice — `packages/engine/modules/pymol/api.py:337` and `:347`). Distribution by defining module:

| module | symbols | file |
|---|---|---|
| `editing` | 76 | `packages/engine/modules/pymol/api.py:185-261` |
| `querying` | 63 | `packages/engine/modules/pymol/api.py:93-156` |
| `viewing` | 58 | `packages/engine/modules/pymol/api.py:356-414` |
| `moving` | 29 | `packages/engine/modules/pymol/api.py:323-352` |
| `importing` | 25 | `packages/engine/modules/pymol/api.py:4-29` |
| `creating` | 22 | `packages/engine/modules/pymol/api.py:33-55` |
| `setting` | 14 | `packages/engine/modules/pymol/api.py:418-432` |
| `commanding` | 13 | `packages/engine/modules/pymol/api.py:65-78` |
| `exporting` | 13 | `packages/engine/modules/pymol/api.py:168-181` |
| `fitting` | 13 | `packages/engine/modules/pymol/api.py:294-307` |
| `experimenting` | 11 | `packages/engine/modules/pymol/api.py:454-465` |
| `controlling` | 8 | `packages/engine/modules/pymol/api.py:82-90` |
| `wizarding` | 8 | `packages/engine/modules/pymol/api.py:283-291` |
| `helping` | 6 | `packages/engine/modules/pymol/api.py:441-447` |
| `selecting` | 5 | `packages/engine/modules/pymol/api.py:159-164` |
| `externing` | 5 | `packages/engine/modules/pymol/api.py:274-279` |
| `preset` | 4 | `packages/engine/modules/pymol/api.py:311-315` |
| `properties` | 4 | `packages/engine/modules/pymol/api.py:478-482` |
| `colorramping` | 3 | `packages/engine/modules/pymol/api.py:58-61` |
| `editor`,`parsing`,`internal` | 2 each | `:263-265`, `:435-437`, `:467-469` |
| `computing`,`morphing`,`keyboard`,`util`,`stereochemistry` | 1 each | `:267`, `:318`, `:450`, `:471`, `:474` |

Plus three whole modules exposed as namespaces for `module.xxx` command syntax:
`cmd.util`, `cmd.movie`, `cmd.gui` (`packages/engine/modules/pymol/api.py:487-489`).

Aliases created outside `api.py`: `matrix_transfer = matrix_copy` (`packages/engine/modules/pymol/api.py:270`),
`get_setting_legacy = get_setting_float` (`packages/engine/modules/pymol/api.py:429`).

### 1.2 `packages/engine/modules/pymol/keywords.py` — the command-language keyword table

`get_command_keywords()` returns a dict `{keyword: [function, min_arg, max_arg, separator, mode]}`
(`packages/engine/modules/pymol/keywords.py:5-333`). Measured: **314 command keywords** + **31 help-only
keywords** from `get_help_only_keywords()` (`packages/engine/modules/pymol/keywords.py:357-390`).

`min_arg`, `max_arg`, `separator` are dead legacy fields for all `STRICT`/`NO_CHECK` commands —
they are `0, 0, ''` for nearly every row and the header comment says so
(`packages/engine/modules/pymol/keywords.py:9-13`). The **only field that matters for the bridge is `mode`**.
Measured mode distribution over the 314 rows:

| mode | count | const line | meaning |
|---|---|---|---|
| `STRICT` (11) | 270 | `packages/engine/modules/pymol/parsing.py:86` | strict name→argument checking |
| `PYTHON` (5) | 13 | `packages/engine/modules/pymol/parsing.py:81` | line is handed to Python (`if`, `for`, `def`, `import`, …) |
| `LEGACY` (13) | 11 | `packages/engine/modules/pymol/parsing.py:88` | supports `str1=val1` → `str1,val1` rewrite |
| `SECURE` (12) | 6 | `packages/engine/modules/pymol/parsing.py:87` | forbidden in "secure" (`.p1m`) files: `run`, `spawn`, `fork`, `save`, `png`, `mpng` |
| `LITERAL1` (21) | 5 | `packages/engine/modules/pymol/parsing.py:90` | 1 parsed arg, rest is a literal Python expression string (`alter`, `iterate`, `label`, `alias`, `set_key`) |
| `LITERAL2` (22) | 2 | `packages/engine/modules/pymol/parsing.py:91` | `alter_state`, `iterate_state` |
| `MOVIE` (1) | 2 | `packages/engine/modules/pymol/parsing.py:77` | `mdo`, `mappend` — whole line, `;` not split |
| `LITERAL` (20) | 1 | `packages/engine/modules/pymol/parsing.py:89` | `system` |
| `ABORT`(4)/`EMBED`(6)/`PYTHON_BLOCK`(7)/`SKIP`(8) | 1 each | `packages/engine/modules/pymol/parsing.py:80,82,83,84` | script-flow constructs |

`fix_dict()` adds non-hashed aliases after table construction: `show_as`, `colour`,
`set_colour`, `recolour`, `bg_colour`, `matrix_transfer`, `util.mrock`, `util.mroll`
(`packages/engine/modules/pymol/keywords.py:339-355`).

The table is instantiated per-instance in `cmd.py` (`packages/engine/modules/pymol/cmd.py:328-339`) and again
in the multi-instance proxy `packages/engine/modules/pymol2/cmd2.py:57-68`.

### 1.3 Runtime-discoverable tables (important for codegen — see §9)

| table | how to obtain | source |
|---|---|---|
| command keywords | `cmd.keyword` (dict) | `packages/engine/modules/pymol/cmd.py:328` |
| keyword shortcut/abbrev index | `cmd.kwhash` (`Shortcut`) | `packages/engine/modules/pymol/cmd.py:332` |
| help-only topics | `cmd.help_only`, `cmd.help_sc` | `packages/engine/modules/pymol/cmd.py:338-339` |
| per-argument completion tables | `cmd.auto_arg` (list of 4 dicts) | `packages/engine/modules/pymol/cmd.py:380`, `packages/engine/modules/pymol/completing.py:74-315` |
| key bindings | `cmd.key_mappings` | `packages/engine/modules/pymol/cmd.py:345`, `packages/engine/modules/pymol/keyboard.py` |
| all setting names→indices | `_cmd.get_setting_indices()` | `packages/engine/modules/pymol/setting.py:38`, `packages/engine/layer4/Cmd.cpp:6496` |
| setting index→name | `setting.name_dict` | `packages/engine/modules/pymol/setting.py:41` |
| representation names | `cmd.repres_sc`, `cmd.repmasks_sc` | referenced `packages/engine/modules/pymol/completing.py:63-64` |
| color names | `cmd.get_color_indices()` via `_validate_color_sc` | `packages/engine/modules/pymol/internal.py:575-591` |

`cmd.write_html_ref(file)` already walks `cmd.keyword`, filters `python_help` entries, and dumps
every docstring to HTML (`packages/engine/modules/pymol/cmd.py:211-310`). **This is a working precedent for
programmatic API extraction** and is the model the TS generator should follow.

---

## 2. How command strings are parsed and executed (`parser.py` / `parsing.py`)

There are **two entirely different execution paths**, and the bridge exposes both.

### 2.1 Path A — string command line (`cmd.do` → C → `parser.parse`)

1. `cmd.do(commands, log=1, echo=1, flush=0)` splits on newlines, sets `defer_updates` when
   given >1 command, and calls `_cmd.do()` under `lockcm` (`packages/engine/modules/pymol/commanding.py:441-475`).
2. C queues/executes and calls back into Python: `G->P_inst->parse` is a closure built by
   `parser.new_parse_closure(cmd)` (`packages/engine/layer1/P.cpp:2038-2040`, `packages/engine/modules/pymol/parser.py:595-601`),
   invoked as `parse(buffer, 0)` (`packages/engine/layer1/P.cpp:2352`, `:2390`).
3. `Parser._parse()` (`packages/engine/modules/pymol/parser.py:182-481`) does, in order:
   - embed/python-block sentinel handling (`:190-215`, `:220-222`)
   - `\` line continuation (`:226-235`)
   - `;` splitting via `parsing.split` (`:239`)
   - `/`-prefix ⇒ literal Python (`:248-252`)
   - assignment-operator sniffing (`=`, `+=`, … from `py_delims`, `packages/engine/modules/pymol/parser.py:43-46`) ⇒ Python (`:253-254`)
   - keyword lookup through `cmd.kwhash` abbreviation resolution, with ambiguity error (`:257-268`)
   - for `mode >= NO_CHECK`: `parsing.parse_arg` then `parsing.prepare_call`, then
     **`self.result = layer.kw[0](*args, **kwargs)`** (`packages/engine/modules/pymol/parser.py:287-292`)
   - `@file` script inclusion with recursion + `stop_on_exceptions` (`:402-445`)
   - fallback: unknown token is executed as literal Python (`:446-452`)
4. Return code semantics: **`1` = ok, `0` = exception, `None` = abort**
   (`packages/engine/modules/pymol/parser.py:481`). Exceptions are caught and *printed*, not propagated
   (`:465-478`). `parser.result` holds the last return value (`:137`, `:292`, `:337`).

**Consequence for the bridge:** `cmd.do()` returns `None` and swallows errors. A web client
that only uses `do()` cannot get return values or structured errors. See §7.

`parsing.parse_arg(st, mode)` returns `[(name|None, value_string), ...]` — everything is a
**string** at this stage (`packages/engine/modules/pymol/parsing.py:150-268`). Nesters (`(...)`, `[...]`) are
kept intact so selections and lists survive (`:178-227`).

`parsing.prepare_call(fn, lst, mode, name)` (`packages/engine/modules/pymol/parsing.py:329-421`) is the real
argument binder:
- unwraps decorators, reads `fn.__code__.co_varnames` / `co_argcount` / `co_kwonlyargcount` /
  `co_posonlyargcount` / `__defaults__` (`:346-360`)
- disables checking for `*args`/`**kw` functions via `co_flags & 0xC` (`:352-353`)
- `cmd ?` ⇒ prints the usage line via `dump_arg` and raises `QuietException`
  (`:365-366`, `dump_arg` at `:311-327`) — this is the `color ?` → `Usage: color color [, selection ...]`
  feature documented in `packages/engine/modules/pymol/cmd.py:251-255`
- `LEGACY` mode rewrites `key=value` into two positional args (`:384-392`)
- injects `_self=` when the target accepts it (`:379`, `:414-415`)
- injects `quiet=0` when `fb_mask.results` is enabled and the caller didn't pass it (`:418-420`)
- raises `QuietException` for missing required args (`:409-411`) and too many positionals (`:400-403`)

**Critically: `prepare_call` performs NO type conversion.** Every value stays a `str`. The
individual API functions coerce with `int(...)`/`float(...)` internally (e.g.
`packages/engine/modules/pymol/setting.py:420-433`, `packages/engine/modules/pymol/internal.py:262-265`).

### 2.2 Path B — direct Python call (`cmd.color("red", "sele")`)

Bypasses the parser entirely. Real Python types accepted, real return values, real exceptions
(`pymol.CmdException`, `packages/engine/modules/pymol/__init__.py:468-480`). **This is the path the RPC bridge
should use** for programmatic calls.

### 2.3 The one typed entry point that already exists: `cmd.new_command`

`commanding.new_command(name, function)` (`packages/engine/modules/pymol/commanding.py:722-782`) is a modern
replacement for `extend`:
- resolves PEP-563 string annotations via `get_type_hints` (`:734-740`)
- wraps the function so that when the caller is `parser.py` (detected by comparing
  `sys._getframe(1).f_code.co_filename` against `pymol.parser.__file__`, `:748-750`) each
  argument string is coerced through `_into_types` (`packages/engine/modules/pymol/commanding.py:619-712`)
- `_into_types` supports `Any`, `bool` (`yes/1/true/on/y` vs `no/0/false/off/n`, `:629-646`),
  `Union`/`|` (`:650-661`), `tuple[...]` via `shlex.split` (`:663-685`), `list[...]` (`:687-693`),
  `StrEnum` (`:695-702`), `Enum` by member name (`:705-713`), and any class accepting a single
  `str` (`:716-723`)
- registers into `cmd.keyword`, `cmd.kwhash`, `cmd.help_sc` with `parsing.STRICT` (`:775-777`)

**Reality check:** only `new_command` itself exists — a grep for callers finds **zero uses**
outside its own definition and the `cmd.py` re-export (`packages/engine/modules/pymol/cmd.py:205`). And
annotations on the actual API are essentially absent: grepping
`^    def <name>(<arg>: <type>` across all `packages/engine/modules/pymol/*.py` yields **6 hits total**
(`packages/engine/modules/pymol/viewing.py:228`, `packages/engine/modules/pymol/commanding.py:548`,
`packages/engine/modules/pymol/editing.py:2141`, `packages/engine/modules/pymol/editing.py:2167`, plus 2 in `cgobuilder.py`).
`get_type_hints`-based codegen therefore cannot be the primary strategy today — see §9.

Older extension mechanisms, still used by plugins and needed by the web client's plugin story:
`extend` (`packages/engine/modules/pymol/commanding.py:788-826`), `extendaa` (`:834-857`, registers auto-complete
entries), `alias` (`:859-893`, builds a `lambda: do('…')` via `eval`).

`cmd.async_(func, *args)` runs a keyword or callable on a daemon thread and pushes a
"please wait ..." `Message` wizard (`packages/engine/modules/pymol/commanding.py:897-935`); it tracks live
threads in `async_threads` which `cmd.sync()` joins (`packages/engine/modules/pymol/commanding.py:382-383`).

---

## 3. Tab completion (`parser.complete` + `completing.py`)

`Parser.complete(st)` acquires `lockcm` and delegates to `_complete`
(`packages/engine/modules/pymol/parser.py:524-593`). Behaviour:
- no space/`@` in the string ⇒ complete a **command name** against `cmd.kwhash` with mode 1
  and `' '` postfix (`:532-536`)
- otherwise resolve the command, count commas outside `[...]` to determine the **argument index**
  (`remove_lists_re`, `packages/engine/modules/pymol/parser.py:48`, `:538-540`), then look up
  `cmd.auto_arg[count][command]` (`:543-557`)
- fallback: **filesystem glob completion** plus `$ENVVAR` completion (`:560-589`)

`complete_sc(st, sc, type_name, postfix, mode)` (`packages/engine/modules/pymol/parser.py:50-87`) is the shared
worker: it calls `sc()` if the shortcut is a lambda (`:53-57`), returns `match+postfix` on a
unique hit, otherwise **prints the candidate list** through `colorprinting.suggest` and returns
the longest common substring (`:64-86`).

`cmd.auto_arg` is a **list of 4 dicts**, one per argument position
(`packages/engine/modules/pymol/completing.py:85-315`): 1st arg (`:87-203`, ~130 commands), 2nd (`:205-276`,
~70), 3rd (`:278-304`, ~25), 4th (`:306-314`, 7). Each entry is
`[shortcut_or_lambda, type_name, postfix]` (`packages/engine/modules/pymol/completing.py:52-66`).
Dynamic ones are lambdas re-evaluated at completion time: `names_sc` (`:50`), `fragments_sc`
(`:37-43`), `vol_ramp_sc` (`:46-48`), `wizard_sc` (`:68-72`), `aa_scene_e` (`:83`), volume/ramp
object lists (`:77-82`).

`ExprShortcut` special-cases `s.<setting>` completion inside `alter`/`iterate`/`label`
expressions (`packages/engine/modules/pymol/completing.py:7-34`).

The Qt GUI drives all of this with a single call: `self.cmd._parser.complete(self.command_get())`
(`packages/engine/modules/pymol/_gui.py:899-904`), bound to Tab (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:422-424`).
It also feeds a plain `QCompleter` from `cmd.kwhash.keywords` (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:214-215`).

**Contract problem for the web:** `complete()` returns only a string (or `None`) and *prints*
the ambiguity list to the feedback stream. A web autocomplete dropdown needs the candidate
list as data. See §8.4.

Command history is pure Python and GUI-side: `_setup_history`, `back`, `forward`, `back_search`,
`_jump_history`, 255-entry cap (`packages/engine/modules/pymol/_gui.py:894-942`). Trivially reimplemented in React.

---

## 4. Feedback / stdout capture (`pcatch`, `feedingback.py`, Ortho queue)

### 4.1 `pcatch` — stdout/stderr hijack

`PCatchInit` creates a built-in C module named `pcatch` with `write`, `writelines`, `flush`,
`isatty`, `_install` (`packages/engine/layer1/P.cpp:2722-2743`). `pcatch._install()` executes
`sys.stderr = sys.stdout = pcatch` (`packages/engine/layer1/P.cpp:2713-2721`). The Qt GL widget calls it at
startup (`packages/engine/modules/pmg_qt/pymol_gl_widget.py:104-105`).

`PCatchWrite` gates on `Feedback(G, FB_Python, FB_Output)` and pushes to
`OrthoAddOutput` (`packages/engine/layer1/P.cpp:2663-2673`); `PCatchWritelines` (`:2676`) does the same per sequence item
(`packages/engine/layer1/P.cpp:2676-2699`).

### 4.2 The Ortho feedback queue

`OrthoFeedbackIn(G, buffer)` pushes onto `I->feedback` **only when `G->Option->pmgui` is true**
(`packages/engine/layer1/Ortho.cpp:492-500`). `OrthoFeedbackOut(G, ortho)` (`:502`) pops one string and strips ANSI escapes
unless the `colored_feedback` setting is on (`packages/engine/layer1/Ortho.cpp:501-515`, decl `packages/engine/layer1/Ortho.h:115`).

`_cmd.get_feedback` (`CmdGetFeedback`, `packages/engine/layer4/Cmd.cpp:3866-3899`, registered `:6463`) pops **one**
string per call, guarded by `G->Ready`, and is explicitly "ALLOWED DURING MODAL DRAWING"
(`packages/engine/layer4/Cmd.cpp:3891`).

`cmd._get_feedback()` (`packages/engine/modules/pymol/internal.py:593-606`) loops `_cmd.get_feedback` until empty
and returns a list; it uses `lock_attempt` and returns **`None` if the lock is busy** (`:596`, `:605`).

The Qt console polls it on a 500 ms `QTimer` (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:391-394`,
`:941-958`), converts to HTML via `colorprinting.text2html` (`packages/engine/modules/pymol/colorprinting.py:17-25`),
and restarts the timer at 0 ms right after a typed command (`:960-964`). Tk skin does the same
(`packages/engine/modules/pmg_tk/skins/normal/__init__.py:489`).

**`G->Option->pmgui` gate is a landmine**: in a headless/`-cq` bridge process, `OrthoFeedbackIn`
drops everything and `_get_feedback()` returns `[]` forever. The bridge must launch with a GUI
option profile that sets `pmgui`, or add a separate sink (§8.3).

### 4.3 Feedback levels

`cmd.feedback(action, module, mask)` (`packages/engine/modules/pymol/feedingback.py:42-176`) — `action` from
`fb_action` (`set/enable/disable/push/pop`, `packages/engine/modules/pymol/constants.py:236-241`), `module` from
`fb_module` (~60 C subsystems with positive indices `packages/engine/modules/pymol/constants.py:243-328`, plus two
Python-only negative ones: `parser=-1`, `cmd=-2` at `:330-331`), `mask` from `fb_mask`
(`output=0x01, results=0x02, errors=0x04, actions=0x08, warnings=0x10, details=0x20,
blather=0x40, debugging=0x80, everything=0xFF` — `packages/engine/modules/pymol/constants.py:331-340`).

Positive modules route to `_cmd.set_feedback` (`packages/engine/modules/pymol/feedingback.py:152-156`); negative
modules are kept in a per-instance Python dict `_self._fb_dict` (`:157-172`, seeded at `:34-40`).
Querying is `cmd._feedback(module, mask)` (`packages/engine/modules/pymol/feedingback.py:11-26`).

`colorprinting` is currently a **no-op shim**: `error`, `warning`, `suggest`, `parrot` are all
literally `print` (`packages/engine/modules/pymol/colorprinting.py:27-31`). So severity is *lost* by the time text
reaches the Ortho queue — everything arrives as one undifferentiated string stream.
`print_exc(strip_filenames)` trims the traceback of parser frames before printing
(`packages/engine/modules/pymol/colorprinting.py:33-47`, used at `packages/engine/modules/pymol/parser.py:475-476`).

### 4.4 Progress / busy

`cmd.get_progress(reset=0)` → `_cmd.get_progress` (`packages/engine/modules/pymol/monitoring.py:5-7`,
`packages/engine/layer4/Cmd.cpp:4315-4345`, registered `:6486`), backed by `PyMOL_GetProgress` /
`PyMOL_GetProgressChanged` (`packages/engine/layer5/PyMOL.cpp:1874-1880`, alongside `PyMOL_GetProgress` at `:1862`). Returns a float; `<0` means idle
(Qt hides the bar, `packages/engine/modules/pmg_qt/pymol_qt_gui.py:931-939`).
`cmd.ready()` wraps `_cmd.ready` (`packages/engine/modules/pymol/monitoring.py:9-11`).
Busy text lives only in C: `OrthoBusyMessage` (`packages/engine/layer1/Ortho.cpp:530-539`), `OrthoBusySlow`
(`packages/engine/layer1/Ortho.cpp:542`) — **not exposed to Python**.

---

## 5. Existing bridge #1: `packages/engine/modules/pymol/pymolhttpd.py` (529 lines)

### 5.1 What it provides

- `HTTPServer` + `BaseHTTPRequestHandler`, single-threaded, one request per
  `handle_request()` in a daemon thread (`packages/engine/modules/pymol/pymolhttpd.py:475-499`).
- Hard localhost check: rejects any client whose address doesn't start with `127.0.`
  with HTTP 403 (`packages/engine/modules/pymol/pymolhttpd.py:61-68`).
- Three URL verbs, dispatched by splitting `self.urlpath` on `/`
  (`packages/engine/modules/pymol/pymolhttpd.py:98-124`):
  - `/apply/<method>` → `pymol_apply` (`:117`, impl `:209-335`)
  - `/getattr/<attr>` → `pymol_getattr`, returns `repr()` of a value that was pre-registered
    under the key `/getattr/<attr>` in the session dict (`:118-119`, impl `:126-142`)
  - `/echo/<...>` → debug echo (`:120-122`, impl `:410-437` — note `echo_args` takes no args but is
    called with one at `:122`, i.e. **this endpoint is broken**)
  - anything else → static file serving from `pymol_root` (`:123-124`, impl `:337-362`)
- Static serving blocks `..` (`:342-344`), auto-appends `index.html` for dirs (`:351-352`), and
  guesses MIME from extension for `.html/.js/.jpg/.png/.gif/.sdf/.mol/.pwg` (`:364-385`).

### 5.2 Wire format of `/apply`

GET query string is parsed with `parse.parse_qs` (`packages/engine/modules/pymol/pymolhttpd.py:93-96`).
POST is **not actually parsed** — `self.fs = self.headers` (`:89-91`), so POST bodies are ignored.
That is a real bug, not a simplification.

Underscore-prefixed params are control params (`packages/engine/modules/pymol/pymolhttpd.py:219-251`):

| param | meaning | line |
|---|---|---|
| `_callback` | JSONP callback name; response becomes `text/javascript` | `:225-226` |
| `_json` | `["method",[args],{kwds}]` **or** a list of such triples for batching | `:229-234` |
| `_method` | method name only (marked "tentative, may disappear") | `:237-239` |
| `_args` | JSON positional args | `:242-243` |
| `_kwds` | JSON keyword args | `:246-247` |

All non-underscore params become string kwargs, taking only `value[0]`
(`packages/engine/modules/pymol/pymolhttpd.py:250-251`) — so **no repeated params, and every value is a string**.

Method resolution (`packages/engine/modules/pymol/pymolhttpd.py:279-281`): look up the exact name in
`self.session`, else if it starts with `pymol.cmd.` strip that 10-char prefix and `getattr` on
the `cmd` module. So the entire `cmd` namespace is reachable as
`/apply/pymol.cmd.<anything>`. Registered session overrides
(`packages/engine/modules/pymol/pymolhttpd.py:462-473`):
- `_quit` → shuts the server down and emits an HTML page with `window.close()` /
  `document.location.replace(href)` (`:306-327`)
- `pymol.cmd.delete_` and `pymol.cmd.super_` — trailing-underscore aliases because `delete`
  and `super` are JS/Python reserved-ish words
- `pymol.cmd.label` is remapped to `cmd.label2` — the **no-eval** variant, explicitly for safety

Responses (`packages/engine/modules/pymol/pymolhttpd.py:144-207`):
- `wrap_natives=1` ⇒ `{"status": "OK"|"ERROR", "result": ...}`, else the bare result (`:144-149`)
- content negotiation on `Accept` against `['text/json','application/json']`
  (`packages/engine/modules/pymol/pymolhttpd.py:33`, `:163-172`); anything else gets an HTML `<pre>` debug page
- errors: `send_json_error(code, message)` (`:174-187`) and `send_exception_json` which appends the
  **full Python traceback split into lines** (`:189-207`)
- batching: when `_json` is a list of lists, only the **last** result is returned —
  `send_multi_result_list` is initialised `False` and then re-set to `False`, so the multi-result
  branch at `:329-330` is **dead code** (`:216`, `:269`, `:331-332`)
- no-cache headers + optional custom headers on every response (`:387-408`)

### 5.3 How it is launched

Only via `.pwg` files: `importing._processPWG` (`packages/engine/modules/pymol/importing.py:516-610`) parses
`port`, `header add K "v"`, `logging`, `root`, `browser`, `launch <module>`, `report <url>`,
`delete`, `options`, `wrap_native_return_types` and then constructs
`PymolHttpd(port, root, logging, wrap_native, headers=headers)` and `.start()`s it
(`packages/engine/modules/pymol/importing.py:592-597`), optionally opening a browser (`:598-601`).

### 5.4 Why it was not built on

**Replace, do not build on.** Concretely: no WebSocket and therefore no server→client push; no
streaming of feedback; POST bodies discarded (`:89-91`); every argument arrives as a string with
no type information; batch semantics broken (`:269`, `:329-332`); `/echo` broken (`:122` vs `:410`);
`threading.Event.isSet()` and `Thread.setDaemon()` are removed/deprecated Python APIs
(`:490`, `:497`, `:502`); no auth token at all — localhost-IP-only (`:64-67`) means **any local
process, including any other browser tab via a plain `<img>`/`fetch` to
`http://localhost:8080/apply/pymol.cmd.system?...`, can drive PyMOL**. That is unacceptable for a
process with full filesystem access.

**Worth keeping as design input:** the `pymol.cmd.<name>` flat namespace idea, the
`[name, args, kwds]` triple, the `{status, result}` envelope, the `delete_`/`super_` reserved-word
convention, the `label`→`label2` no-eval substitution, and the localhost check as a *first* layer.

---

## 6. Existing bridge #2: `packages/engine/modules/pymol/rpc.py` (474 lines, XML-RPC)

`launch_XMLRPC(hostname='', port=9123, nToTry=5)` (`packages/engine/modules/pymol/rpc.py:411-472`):
- host from `$PYMOL_RPCHOST` else `localhost` (`:422-424`)
- tries 5 consecutive ports (`:428-435`)
- `SimpleXMLRPCServer(..., logRequests=0, allow_none=True)` (`:430-431`)
- **`serv.register_instance(cmd)` (`packages/engine/modules/pymol/rpc.py:441`) — this exposes the ENTIRE `cmd`
  module over XML-RPC by attribute lookup.** Every one of the 404 api symbols is callable.
- plus 17 hand-written legacy `rpcXxx` wrappers registered under camelCase names
  (`:444-465`): `ping`, `resetCGO`, `renderCGO`, `sphere`, `spheres`, `cylinder`, `deleteObject`,
  `deleteAll`, `loadPDB`, `loadMolBlock`, `loadSurface`, `loadSurfaceData`, `loadFile`,
  `getNames`, `countAtoms`, `idAtom`, `help`, `getAtomCoords`
- **`label` and `rotate` are registered last and therefore SHADOW the real `cmd.label` and
  `cmd.rotate`** — the source itself flags this: "legacy stuff, should be removed because
  overwrites API names!" (`packages/engine/modules/pymol/rpc.py:463-465`). `rpcLabel` actually creates a
  pseudoatom (`:38-54`) and `rpcRotate` takes an xyz vector (`:354-367`).
- `register_introspection_functions()` gives `system.listMethods` / `system.methodSignature` /
  `system.methodHelp` (`packages/engine/modules/pymol/rpc.py:467`)
- `rpcHelp(what)` reflects on `__defaults__`/`__code__.co_varnames` to build a usage string
  (`packages/engine/modules/pymol/rpc.py:382-408`) — another codegen precedent
- module-global `cgoDict` accumulates CGO buffers per id (`:426-427`, used `:56-147`)
- launched with the `-R` CLI flag → `options.rpcServer = 1`
  (`packages/engine/modules/pymol/invocation.py:184`, `:453`) which defers
  `'_do__ /import pymol.rpc;pymol.rpc.launch_XMLRPC()'` (`packages/engine/modules/pymol/invocation.py:521-522`)

### 6.1 Why it was not built on

**Replace.** XML-RPC is synchronous request/response only, has no binary type (base64-bloated),
no push, no streaming, no kwargs (XML-RPC is positional-only — so `cmd.load(f, object='x')` is
unreachable via the generic instance registration), and `register_instance` on a module means
**arbitrary attribute traversal into `cmd`** (including `cmd.system`, `cmd.run`, `cmd.spawn`,
`cmd._quit`). It binds to `''`/`$PYMOL_RPCHOST` with **no localhost restriction and no auth**
(`:422-424`, `:430`) — strictly worse than `pymolhttpd`.

**Worth keeping as design input:** the "expose the whole `cmd` module generically" decision, and
`rpcHelp`'s signature reflection.

---

## 7. What the C++ layer can emit

### 7.1 Exists

| capability | mechanism | source |
|---|---|---|
| Python stdout/stderr → text stream | `pcatch` → `OrthoAddOutput` → Ortho queue | `packages/engine/layer1/P.cpp:2663-2699`, `:2713-2743` |
| pull one feedback line | `_cmd.get_feedback` / `cmd._get_feedback()` | `packages/engine/layer4/Cmd.cpp:3866-3899`, `packages/engine/modules/pymol/internal.py:593-606` |
| progress 0..1 (+ changed flag) | `_cmd.get_progress`, `PyMOL_GetProgressChanged` | `packages/engine/modules/pymol/monitoring.py:5-7`, `packages/engine/layer5/PyMOL.cpp:1862-1880` |
| settings changed since last poll | `_cmd.get_setting_updates(object, state)` | `packages/engine/modules/pymol/setting.py:440-447`, `packages/engine/layer4/Cmd.cpp:6495` |
| "needs redraw" flag | `PyMOL_GetRedisplay` / `_cmd._getRedisplay` | `packages/engine/layer5/PyMOL.h:282`, `packages/engine/layer4/Cmd.cpp:6378`, `packages/engine/modules/pymol2/__init__.py:36-37` |
| idle work pump | `_cmd._idle` / `PyMOL.idle()` | `packages/engine/layer4/Cmd.cpp:6374`, `packages/engine/modules/pymol2/__init__.py:33-34` |
| image ready / image data | `PyMOL_GetImageReady`, `PyMOL_GetImageData` | `packages/engine/layer5/PyMOL.h:287-292` |
| click-ready + click string | `PyMOL_SetClickReady`/`GetClickReady`/`GetClickString`, `_cmd.get_click_string` | `packages/engine/layer5/PyMOL.cpp:2594-2640`, `packages/engine/layer4/Cmd.cpp:1420-1430`, `:6451` |
| **object enable/disable callback** | `G->enabledCallback(obj, name, visible)` from `ReportEnabledChange` | `packages/engine/layer3/Executive.cpp:313-322`, `packages/engine/layer5/PyMOL.cpp:3060-3066`, `packages/engine/layer0/PyMOLGlobals.h:195-196` |
| post-draw raw image → Python | `cmd.raw_image_callback(numpy_rgba)` | `packages/engine/layer1/Scene.cpp:4015-4048`, slot declared `packages/engine/modules/pymol/cmd.py:384` |
| C→Python: parse a line | `G->P_inst->parse` closure | `packages/engine/layer1/P.cpp:2038-2040`, `:2352`, `:2390` |
| C→Python: complete a line | `G->P_inst->complete` closure | `packages/engine/layer1/P.cpp:2046-2048`, `:1195` |
| C→Python: menus | `PYOBJECT_CALLMETHOD(P_menu, name, ...)` | `packages/engine/layer4/Menu.cpp:37`, `:58`, `:78`, `:97`, `:117` |
| C→Python: cache get/set | `cmd._cache_get` / `_cache_set` | `packages/engine/layer1/P.cpp:1369-1391` |
| C→Python: thread spawns | `_ray_spawn`, `_object_update_spawn`, `_coordset_update_spawn` | `packages/engine/layer1/Ray.cpp:2894`, `:2919`, `:2962`; `packages/engine/layer1/Scene.cpp:4636`; `packages/engine/layer2/ObjectMolecule.cpp:10755` |
| C→Python: ligand CIF download | `cmd.download_chem_comp` | `packages/engine/layer2/CifMoleculeReader.cpp:3409-3410` |

**Big caveat on `enabledCallback`:** it is wrapped in `#ifdef _PYMOL_LIB`
(`packages/engine/layer3/Executive.cpp:315-319`), so in a normal Python build it is **compiled out**. And
`PyMOL_SetIsEnabledCallback` takes a raw C function pointer (`packages/engine/layer5/PyMOL.h:565`) — there is
**no Python binding**; grepping the whole tree for `SetIsEnabledCallback` finds only the
declaration, the definition, and the call site. It is *the right hook shape* but is not usable
from Python today.

### 7.2 DOES NOT EXIST

A repo-wide grep for `Notify`/`notify` across `layer0`–`layer5` returns **zero matches**. There is
no event bus in the C++ core. The following have **no notification whatsoever**:

1. **Object list changed** (object created/deleted/renamed/reordered/grouped). Only pollable via
   `cmd.get_names()` (`packages/engine/modules/pymol/querying.py:1155-1199`, 10 modes) /
   `cmd.get_names_of_type` (`:1459`) / `cmd.get_object_list` (`:131`).
2. **Object enabled/disabled** — `ReportEnabledChange` exists but is `_PYMOL_LIB`-only and
   unbound (see above). Pollable via `cmd.get_names(..., enabled_only=1)` or `cmd.get_vis()`
   (`packages/engine/modules/pymol/viewing.py:899-901`).
3. **View changed** (camera moved by mouse drag, `zoom`, `orient`, scene recall). Only
   `cmd.get_view()` polling (`packages/engine/modules/pymol/viewing.py:634-733`; returns an 18-float tuple, layout
   documented at `:663-677`).
4. **Frame / state changed** (movie playing, `frame`, `mset`). Only `cmd.get_frame()`
   (`packages/engine/modules/pymol/moving.py:984`), `cmd.get_state()` (`:958`), `cmd.get_movie_playing()` (`:64`).
5. **Selection changed** (named selection created/modified, atom picked in viewport). There is a
   click string (`packages/engine/layer4/Cmd.cpp:1420-1430`) but grepping `packages/engine/modules/` for `get_click_string`
   returns **zero Python callers** — it is dead from Python's side.
6. **Representation/color changed on an object.**
7. **Scene list changed** — `cmd.get_scene_list()` poll only (`packages/engine/modules/pymol/viewing.py:919`).
8. **Wizard prompt/panel changed** — `cmd.get_wizard()` / `get_wizard_stack()` poll only
   (`packages/engine/modules/pymol/wizarding.py:156-174`); `dirty_wizard` (`:146`) sets a C flag, no Python signal.
9. **Undo/redo stack changed** — `cmd.undo`/`redo`/`push_undo` exist (`packages/engine/modules/pymol/api.py:223`,
   `:227`, `:256`) with no depth query and no event.
10. **Busy message text** — `OrthoBusyMessage` is C-internal (`packages/engine/layer1/Ortho.cpp:530-539`).
11. **Severity/category on feedback lines** — `colorprinting.error/warning/suggest/parrot` are all
    `print` (`packages/engine/modules/pymol/colorprinting.py:27-31`); the stream is untyped text.
12. **Return value from a parsed command line** — `cmd.do()` returns `None`
    (`packages/engine/modules/pymol/commanding.py:441-475`); `parser.result` is stored (`packages/engine/modules/pymol/parser.py:292`)
    but is *not* returned through `_cmd.do`.

---

## 8. The bridge

### 8.1 Process & transport

Single Python process, launched with `pmgui` enabled so `OrthoFeedbackIn` actually queues
(`packages/engine/layer1/Ortho.cpp:494`). It uses `pymol2.SingletonPyMOL`, **not**
`pymol2.PyMOL` (`packages/engine/modules/pymol2/__init__.py:79-131`): `pcatch` writes through the
file-scope `SingletonPyMOLGlobals` pointer (`packages/engine/layer1/P.cpp:2667`), so a non-singleton
instance loses stdout capture. `PyMOL.cmd` is a `pymol2.cmd2.Cmd` proxy that builds its own
keyword/shortcut tables (`packages/engine/modules/pymol2/cmd2.py:57-78`).

- **HTTP/1.1 on `127.0.0.1:<port>`** (bind explicitly to loopback, unlike `rpc.py:430`) for:
  - `GET /healthz` → `{version, renderer, pid}` from `cmd.get_version()`
    (`packages/engine/modules/pymol/api.py:147`) and `cmd.get_renderer()` (`packages/engine/modules/pymol/api.py:142`)
  - `GET /schema` → the generated API descriptor (§9)
  - `GET /blob/{id}` and `POST /blob` for large payloads (PNG from `cmd.png`
    `packages/engine/modules/pymol/exporting.py:499`, session bytes from `cmd.get_session`
    `packages/engine/modules/pymol/exporting.py:371`, `cmd.get_bytes` `:679`, geometry buffers)
  - `POST /upload` for drag-and-drop file ingestion (mirrors
    `packages/engine/modules/pmg_qt/pymol_gl_widget.py:262-270`)
- **WebSocket on `127.0.0.1:<port>/ws`** — the primary channel. Binary frames carry MessagePack
  (`msgpack` is already a dev dependency, `pyproject.toml:33`); text frames carry JSON for
  debuggability. One socket per client; server rejects a second concurrent socket.
- **Auth:** a 256-bit token minted at startup, written to a 0600 file under the user's runtime dir
  and passed as `?token=`. Reject on mismatch **and** enforce `Origin` allow-listing **and** keep
  the `127.0.` peer check from `packages/engine/modules/pymol/pymolhttpd.py:63-67`. Without this, any web page can
  reach `cmd.system` (`packages/engine/modules/pymol/api.py:279`) / `cmd.run` (`:436`).

### 8.2 Message envelope

```jsonc
// client -> server
{ "id": 42, "t": "call",     "m": "get_view", "a": [], "k": {} }
{ "id": 43, "t": "call",     "m": "load", "a": ["/x/1abc.cif"], "k": {"object":"m1"} }
{ "id": 44, "t": "batch",    "calls": [ {"m":"hide","a":["everything"]},
                                        {"m":"show","a":["cartoon","polymer"]} ] }
{ "id": 45, "t": "do",       "line": "color red, chain A" }        // parser path, §2.1
{ "id": 46, "t": "complete", "line": "col" }                        // §3
{ "id": 47, "t": "cancel",   "target": 43 }                         // -> cmd.interrupt / abort
{ "id": 48, "t": "sub",      "topics": ["objects","view","frame","feedback","progress"] }

// server -> client
{ "id": 42, "t": "ok",   "v": [ /* 18 floats */ ] }
{ "id": 43, "t": "err",  "e": { "kind": "CmdException", "label": "Error",
                                "message": "...", "traceback": ["..."] } }
{           "t": "ev",   "topic": "feedback", "seq": 991, "v": { "lines": ["..."] } }
{           "t": "ev",   "topic": "objects",  "seq": 992, "v": { /* §8.5 */ } }
{ "id": 43, "t": "prog", "v": 0.42 }
```

Rules:
- `id` is a client-monotonic u32; every `call`/`batch`/`do`/`complete` gets exactly one
  terminal `ok` or `err`. Events carry no `id`.
- `m` is a **flat `cmd` attribute name** — `"get_view"`, not `"pymol.cmd.get_view"`. Drop
  `pymolhttpd`'s 10-char-prefix trick (`packages/engine/modules/pymol/pymolhttpd.py:280-281`) but keep its
  reserved-word aliasing convention (`delete_`, `super_`, `packages/engine/modules/pymol/pymolhttpd.py:468-469`)
  as a *client-side* concern only — the wire uses real names.
- Dotted names `util.cbag`, `movie.produce` etc. resolve by splitting on `.` and walking, matching
  the keyword table (`packages/engine/modules/pymol/keywords.py:307-332`).
- **Allow-list, not attribute traversal.** The dispatcher resolves `m` against a frozen dict built
  from `api.py`'s exports ∪ `cmd.keyword`, minus a deny-list. Deny by default:
  `system` (`packages/engine/modules/pymol/api.py:279`), `run`/`spawn` (`:436-437`), `quit`/`_quit`
  (`packages/engine/modules/pymol/keywords.py:281-282`), `cd` (`:39`), everything starting with `_`. Gate them
  behind an explicit `--allow-unsafe` bridge flag. Note `pymolhttpd` already made this call for
  `label` → `label2` to avoid `eval` (`packages/engine/modules/pymol/pymolhttpd.py:473`); do the same, and
  additionally sandbox `alter`/`iterate`/`alter_state`/`iterate_state` (the `LITERAL1`/`LITERAL2`
  commands, `packages/engine/modules/pymol/keywords.py:19,21,144,145,147`) behind the same flag since their last
  argument is `eval`'d Python.

### 8.3 Typed arguments

Because `prepare_call` never converts types (§2.1) but direct Python calls do accept real types
(§2.2), the bridge should **always take Path B**: JSON/MessagePack values are passed straight
through as Python objects to `getattr(cmd, m)(*a, **k)`.

- ints/floats/bools/strings/lists/dicts map 1:1
- 18-float view vectors are plain arrays → `cmd.set_view(list)` (`packages/engine/modules/pymol/viewing.py:734`)
- `bytes` ride as MessagePack bin, or via `/blob` for anything > 256 KiB
- `None` ⇒ Python `None` (needed for e.g. `set_bond(..., selection2=None)`,
  `packages/engine/modules/pymol/setting.py:116`)
- **Never** send `_self`; the dispatcher injects the instance's `Cmd` proxy itself, mirroring
  `parsing.prepare_call`'s behaviour (`packages/engine/modules/pymol/parsing.py:379`, `:414-415`).
- Set `quiet=1` by default; the parser's implicit `quiet=0` injection
  (`packages/engine/modules/pymol/parsing.py:418-420`) applies only to the `do` path and should be preserved there
  so the console behaves like PyMOL's.
- Wrap every dispatch in `try/except`; map `pymol.CmdException` (`packages/engine/modules/pymol/__init__.py:468-480`,
  carries `.message` and `.label`) and `parsing.QuietException` (`packages/engine/modules/pymol/parsing.py:71-72`)
  to `t:"err"` with `kind`/`label`/`message`, and everything else to `kind:"PythonError"` plus a
  `traceback.format_exception` array — the same shape `send_exception_json` already produces
  (`packages/engine/modules/pymol/pymolhttpd.py:189-207`).

The `do` path (`t:"do"`) exists for the console widget only. It calls `cmd.do(line)`
(`packages/engine/modules/pymol/commanding.py:441`), which returns `None` and swallows errors by design
(`packages/engine/modules/pymol/parser.py:465-478`). The `ok` value for a `do` is therefore always `null`; the
result surfaces as feedback text. **Do not** use `do` for programmatic UI actions.

Long-running calls (`ray` `packages/engine/modules/pymol/viewing.py:1662`, `png` with `ray=1`
`packages/engine/modules/pymol/exporting.py:499`, `align`/`super`, `map_generate`) must run off the socket
read loop. Use `cmd.async_`-style threading (`packages/engine/modules/pymol/commanding.py:897-935`) or a bounded
worker pool, streaming `t:"prog"` frames from `cmd.get_progress()`
(`packages/engine/modules/pymol/monitoring.py:5-7`) until the terminal `ok`. `cmd.sync(timeout, poll)`
(`packages/engine/modules/pymol/commanding.py:382-439`) is the barrier when the client needs
"everything queued has run" semantics.

### 8.4 Completion contract

`t:"complete"` must return **data, not a string**, because `parser._complete` prints the
candidate list instead of returning it (`packages/engine/modules/pymol/parser.py:64-69`, `:583-586`).

Two options, in order of preference:

1. **Reimplement in the bridge.** Duplicate the 60-line dispatch of
   `Parser._complete` (`packages/engine/modules/pymol/parser.py:528-596`) but return
   `{ "prefix": str, "candidates": [str], "kind": "command"|"selection"|"color"|"setting"|"file"|…,
   "commonPrefix": str }`. All inputs are public: `cmd.kwhash` (`packages/engine/modules/pymol/cmd.py:332`),
   `cmd.auto_arg` (`packages/engine/modules/pymol/cmd.py:380`), and `Shortcut.interpret(keyword, mode)`
   (`packages/engine/modules/pymol/shortcut.py`, used at `packages/engine/modules/pymol/parser.py:58`). `kind` comes for free —
   it is the `type_name` element of each `auto_arg` triple
   (`packages/engine/modules/pymol/completing.py:52-66`).
2. Wrap `cmd._parser.complete(st)` (`packages/engine/modules/pymol/parser.py:524-526`) and read the
   printed candidate list out of the feedback queue. This is what shipped: the console calls
   `cmd._parser.complete` (granted in `packages/bridge/tenmol_bridge/policy/grants/wp-11-console.py`)
   and pairs the completed string with the feedback lines
   (`apps/web/src/features/console/CommandLine.tsx`).

Also expose `t:"usage"` → run the `?` path: `parsing.dump_arg(name, arg_names, nreq)`
(`packages/engine/modules/pymol/parsing.py:311-327`) reimplemented to *return* the usage string, giving the web
command line the same `color ?` behaviour documented at `packages/engine/modules/pymol/cmd.py:251-255`.

And `t:"help"` → `cmd.keyword[name][0].__doc__` / `cmd.help_only[name][0].__doc__`, exactly as
`helping.help` does (`packages/engine/modules/pymol/helping.py:62-87`) and `write_html_ref` does in bulk
(`packages/engine/modules/pymol/cmd.py:285-307`).

### 8.5 Change events

Given §7.2, change detection is built in **three tiers**.

**Tier 0 — free today, no C++ change.** A bridge-side "tick" task (default 100 ms, coalesced,
suspended when no client is connected) that:
- drains `cmd._get_feedback()` (`packages/engine/modules/pymol/internal.py:593-606`) → `topic:"feedback"`.
  Must tolerate the `None` return when the lock is contended (`:605`). Cap and coalesce; the Qt
  console uses a 500 ms period and resets to 0 ms right after a typed command
  (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:958`, `:964`) — mirror that: bump to 0 ms after any
  `do`/`call`, back off to 250 ms when idle.
- calls `cmd.get_progress()` (`packages/engine/modules/pymol/monitoring.py:5-7`) → `topic:"progress"` when the
  value changes or crosses the `<0` idle threshold.
- calls `cmd.get_setting_updates()` (`packages/engine/modules/pymol/setting.py:440-447`) → `topic:"settings"`,
  emitting `{name, value}` per changed index via `setting.name_dict`
  (`packages/engine/modules/pymol/setting.py:41`) + `cmd.get_setting_tuple` (`:413`). **This one is a real
  push-quality signal** — it is exactly what the Qt GUI uses to keep its setting widgets in sync
  (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:952-957`).
- calls `_cmd._getRedisplay(COb, reset)` (`packages/engine/layer4/Cmd.cpp:6378`,
  `packages/engine/modules/pymol2/__init__.py:36-37`) as a **coarse dirty bit**. When set, re-poll the cheap
  aggregates and diff.

**Tier 1 — diff-based synthetic events (no C++ change, but O(n) per tick).** Maintain a shadow
snapshot and emit only deltas:

| topic | polled from | source |
|---|---|---|
| `objects` | `cmd.get_names('all')` + per-name `cmd.get_type` + `cmd.get_names(..., enabled_only=1)` | `packages/engine/modules/pymol/querying.py:1155-1199`, `:1206`, `packages/engine/modules/pymol/viewing.py:899` |
| `view` | `cmd.get_view()` (18 floats), compare with epsilon | `packages/engine/modules/pymol/viewing.py:634-733` |
| `frame` | `cmd.get_frame()`, `cmd.get_state()`, `cmd.get_movie_playing()`, `cmd.count_frames()` | `packages/engine/modules/pymol/moving.py:984`, `:958`, `:64`; `packages/engine/modules/pymol/api.py:98` |
| `scenes` | `cmd.get_scene_list()` | `packages/engine/modules/pymol/viewing.py:919` |
| `selection` | `cmd.get_names('public_selections')` + `cmd.count_atoms(name)` per selection | `packages/engine/modules/pymol/querying.py:1155`, `packages/engine/modules/pymol/api.py:97` |
| `wizard` | `cmd.get_wizard_stack()` and the wizard's prompt/panel | `packages/engine/modules/pymol/wizarding.py:166-174` |
| `colors` | `cmd.get_color_indices()` (only when `_invalidate_color_sc` would fire) | `packages/engine/modules/pymol/internal.py:584-591` |

Gate all of Tier 1 behind the redisplay dirty bit so an idle session costs ~one syscall per tick.
Cost concern: `view` at 100 ms is fine; `objects` on a 500-object session is not — key it to the
dirty bit and to a "mutating call just completed" hint from the dispatcher (any `m` not starting
with `get_`/`count_`).

**Tier 2 — C++ additions.** Tier 0 + Tier 1 shipped first (pure Python, zero C++ risk, works
against an unmodified backend). Three of the seven items below then landed in the engine, each
inside a `/* tenmol web client -- BEGIN/END */` sentinel block so the diff against upstream is
greppable:

1. **Landed.** Four monotonic counters on `struct CExecutive` — `m_web_panel_version`,
   `m_web_enable_version`, `m_web_name_version`, `m_web_rep_version`
   (`packages/engine/layer3/ExecutiveDef.h:89-98`), bumped at
   `ExecutiveInvalidatePanelList` (`Executive.cpp:1521`), `ReportEnabledChange` (`:315`),
   the rename path (`:3686`), `ExecutiveUpdateCoordDepends` (`:1931`) and the transform paths
   (`:7695`, `:7717`). Read through `_cmd.web_get_versions`
   (`packages/engine/layer4/Cmd.cpp:6472`, implementation `packages/engine/layer4/CmdWebGeometry.cpp`). This alone
   turns Tier 1 from "diff N object names" into "compare four integers", which is what made an
   idle session cost ~1 us per poll. Consumed by
   `packages/bridge/tenmol_bridge/state/repversions.py`.
2. **Partly landed.** `ReportEnabledChange` (`Executive.cpp:313`) now bumps
   `m_web_enable_version` for *every* enable and disable; the `#ifdef _PYMOL_LIB` callback above
   it is untouched. No `_cmd.get_events()` queue was added — the counter made one unnecessary.
3. **Not landed.** There is still no view counter in `SceneSetView`/`SceneRotate`/`SceneTranslate`;
   the camera is detected by comparing the 18-float `get_view()` with an epsilon (Tier 1).
4. **Landed differently.** Rather than emit an event from `PyMOL_SetClickReady`
   (`packages/engine/layer5/PyMOL.cpp:2594-2600`), the client resolves a pick it already made
   against the engine through `_cmd.web_resolve_pick` (`Cmd.cpp:6473`). `_cmd.get_click_string`
   (`Cmd.cpp:6451`) still has zero Python callers upstream.
5. **Not landed.** `colorprinting.error/warning/suggest/parrot`
   (`packages/engine/modules/pymol/colorprinting.py:27-31`) are still bare `print`, so the stream
   is untyped text; the bridge classifies lines itself in
   `packages/bridge/tenmol_bridge/feedback.py`.
6. **Not needed.** The `G->Option->pmgui` gate on `OrthoFeedbackIn` (`packages/engine/layer1/Ortho.cpp:494`)
   stands; the bridge boots with `pmgui` enabled so the queue fills (§8.1).
7. **Not landed.** `parser.result` (`packages/engine/modules/pymol/parser.py:292`) is still not
   returned through `_cmd.do`, so a `do` frame still resolves to `null` and the result surfaces as
   feedback text.

### 8.6 Key bindings

`cmd.set_key(key, fn, arg, kw)` (`packages/engine/modules/pymol/controlling.py:719-780`) writes into
`cmd.key_mappings` (`packages/engine/modules/pymol/cmd.py:345`, defaults from `keyboard.get_default_keys()`).
Invocation from C goes through `cmd._special` / `_ctrl` / `_alt` / `_ctsh`
(`packages/engine/modules/pymol/internal.py:447-511`), which resolve via `_invoke_key`
(`packages/engine/modules/pymol/internal.py:427-446`) and fall back to matching **scene names** and **view names**
(`packages/engine/modules/pymol/internal.py:470-483`). Special-key numeric codes are GLUT's, mapped in
`special_key_codes` (`packages/engine/modules/pymol/internal.py:398-423`) with modifier prefixes
`''/SHFT/CTRL/CTSH/ALT` (`packages/engine/modules/pymol/internal.py:390-396`).

Web contract: expose `GET /keymap` (serialise `cmd.key_mappings`; string values are PML, tuple
values are opaque Python and should serialise as `{"kind":"python","repr":...}`), and let the
React key handler send `{t:"key", key:"CTRL-C"}` which the bridge routes to
`cmd._invoke_key(key)`. Do **not** try to synthesise GLUT codes in the browser.

---

## 9. Generating the TypeScript client from Python

404 method signatures are generated, not hand-written. The generator lives in `tools/gen-api/`
(`extract.py`, `emit.mjs`, `api-schema.json`) and its output is
`packages/protocol/src/generated/api.ts`. Signatures come from a **live** PyMOL via
`inspect.signature`, not from parsing `api.py` — which is a re-export manifest with no function
bodies.

### 9.1 Reality of the source material

- Type annotations: **6 in the entire API** (`packages/engine/modules/pymol/viewing.py:228`,
  `packages/engine/modules/pymol/commanding.py:548`, `packages/engine/modules/pymol/editing.py:2141`, `:2167`, plus `cgobuilder.py`).
  So `get_type_hints` alone yields almost nothing.
- Defaults: **universally present and informative**. Every API function is
  `def f(a='(all)', state=-1, quiet=1, *, _self=cmd)`. `inspect.signature` gives name, kind
  (POSITIONAL_ONLY / POSITIONAL_OR_KEYWORD / KEYWORD_ONLY / VAR_*), and default value.
  `parsing.prepare_call` already relies on exactly this data
  (`packages/engine/modules/pymol/parsing.py:346-360`) — so does `rpcHelp` (`packages/engine/modules/pymol/rpc.py:392-405`).
- Docstrings: highly regular. Uppercase section headers `DESCRIPTION`, `USAGE`, `ARGUMENTS`,
  `NOTES`, `PYMOL API`, `EXAMPLES`, `SEE ALSO`. `write_html_ref` already parses them by detecting
  `line.isupper()` and `SEE ALSO` (`packages/engine/modules/pymol/cmd.py:290-303`). `ARGUMENTS` blocks are
  `name = type: description {default: x}` — e.g.
  `packages/engine/modules/pymol/commanding.py:107-110`, `packages/engine/modules/pymol/feedingback.py:52-58`,
  `packages/engine/modules/pymol/viewing.py:650-656`.
- Completion tables give **semantic domains**: `cmd.auto_arg[i][command]` says argument `i` of
  `command` is a `'selection'` / `'color'` / `'setting'` / `'representation'` / `'object'` /
  `'scene'` / `'palette'` / … (`packages/engine/modules/pymol/completing.py:52-66`, `:85-315`).
- Runtime enums: `_cmd.get_setting_indices()` (`packages/engine/modules/pymol/setting.py:38`) for all setting
  names; `cmd.get_color_indices()` (`packages/engine/modules/pymol/internal.py:579`) for all colors; the
  `Shortcut` objects `viewing.cartoon_sc`, `viewing.clip_action_sc`, `viewing.scene_action_sc`,
  `controlling.button_sc`/`but_mod_sc`/`but_act_sc`, `editing.flag_sc`/`flag_action_sc`/`order_sc`,
  `creating.map_type_sc`/`group_action_sc`, `exporting.cache_action_sc`,
  `moving.mview_action_sc`, `commanding.reinit_sc` — all referenced from
  `packages/engine/modules/pymol/completing.py:97-307` and each exposes `.keywords` (`packages/engine/modules/pymol/shortcut.py:41-49`).
- `keywords.get_command_keywords()` gives the `mode` per command, which tells the generator which
  commands are `LITERAL*`/`PYTHON`/`SECURE` and must be typed specially or excluded
  (`packages/engine/modules/pymol/keywords.py:14-333`).

### 9.2 Pipeline

```
tools/gen-api/
  extract.py     # runs INSIDE a live PyMOL, dumps api-schema.json
  api-schema.json
  emit.mjs       # reads api-schema.json, writes packages/protocol/src/generated/api.ts
```

Regenerate with:

```bash
packages/bridge/.venv/bin/python tools/gen-api/extract.py > tools/gen-api/api-schema.json
node tools/gen-api/emit.mjs tools/gen-api/api-schema.json packages/protocol/src/generated/api.ts
```

**Step 1 — `extract.py`** (a build-time script, run under `pymol -cq extract.py`, never shipped):

```python
import inspect, json, pymol
from pymol import cmd, keywords, setting

kw = keywords.get_command_keywords()          # packages/engine/modules/pymol/keywords.py:5
out = {"functions": {}, "keywords": {}, "enums": {}, "autoArg": []}

for name in dir(cmd):                          # api.py exports, via cmd.py:319
    fn = getattr(cmd, name)
    if not callable(fn) or name.startswith('_'):
        continue
    try:
        sig = inspect.signature(inspect.unwrap(fn))
    except (TypeError, ValueError):
        continue
    out["functions"][name] = {
        "module": getattr(fn, "__module__", None),
        "doc": inspect.getdoc(fn),
        "params": [
            {"name": p.name,
             "kind": p.kind.name,
             "hasDefault": p.default is not p.empty,
             "default": repr(p.default) if p.default is not p.empty else None,
             "annotation": None if p.annotation is p.empty else str(p.annotation)}
            for p in sig.parameters.values() if p.name != "_self"
        ],
    }

for k, row in kw.items():
    out["keywords"][k] = {"target": getattr(row[0], "__name__", None), "mode": row[4]}

out["enums"]["setting"] = sorted(setting.index_dict)          # setting.py:38
out["enums"]["color"]   = [c[0] for c in cmd.get_color_indices()]   # internal.py:579
out["autoArg"] = [
    {c: t[1] for c, t in table.items()}                       # completing.py:52-66
    for table in cmd.auto_arg                                  # cmd.py:380
]
json.dump(out, open("api-schema.json", "w"), indent=1)
```

Everything this script touches is verified above to exist: `cmd.auto_arg` (`packages/engine/modules/pymol/cmd.py:380`),
`setting.index_dict` (`packages/engine/modules/pymol/setting.py:38`), `cmd.get_color_indices`
(`packages/engine/modules/pymol/api.py:112`), `keywords.get_command_keywords` (`packages/engine/modules/pymol/keywords.py:5`).

**Step 2 — type inference**, in priority order per parameter:
1. explicit annotation, if present (the 6 cases)
2. `auto_arg` domain → branded alias: `'selection'`→`Selection`, `'color'`→`ColorName`,
   `'object'`→`ObjectName`, `'setting'`→`SettingName`, `'representation'`→`RepName`,
   `'scene'`→`SceneName`, `'palette'`→`PaletteName`
3. default-value type: `1`/`0` on a param named `quiet`/`updates`/`animate`/`hand`/`ray` →
   `boolean | 0 | 1`; other ints → `number`; strings → `string`; tuples → fixed-length tuple
4. `ARGUMENTS` docstring line `name = int: …` / `= str:` / `= float:` / `= list:` — parsed with the
   same uppercase-section walk `write_html_ref` (`packages/engine/modules/pymol/cmd.py:211`) uses (`:290-303`)
5. name heuristics: `state`/`frame`/`width`/`height`/`dpi`→`number`, `filename`/`prefix`→`string`,
   `*_sele`/`selection*`→`Selection`
6. fallback `ApiValue = string | number | boolean | null | ApiValue[] | {[k:string]:ApiValue}`

Return types: annotate from a **hand-maintained override table** of ~40 entries, because they
cannot be inferred. Seed it from the ones documented above: `get_view` → `View18`
(`packages/engine/modules/pymol/viewing.py:663-677`), `get_names` → `string[]`
(`packages/engine/modules/pymol/querying.py:1198`), `get_setting_tuple` → `[number, unknown[]]`
(`packages/engine/modules/pymol/setting.py:413-418`), `count_atoms`/`count_states`/`count_frames`/`get_frame`/
`get_state` → `number`, `get_extent` → `[Vec3, Vec3]`, `get_color_tuple` → `RGB`,
`get_progress` → `number` (`packages/engine/modules/pymol/monitoring.py:5-7`). Everything else defaults to
`unknown` and is narrowed over time. **The override table lives in the repo and is diff-reviewed;
the rest is regenerated.**

**Step 3 — `emit.ts`** produces, per function:

```ts
export interface ColorOptions { selection?: Selection; quiet?: 0|1; flags?: number }
/** Change the color of an object or selection.  (pymol.viewing.color) */
export function color(client: PymolClient, color: ColorName, opts?: ColorOptions): Promise<unknown>;
```

Rules: params before the first defaulted one become required positionals; the defaulted tail
collapses into one optional options object (matching how PyMOL is actually called);
`KEYWORD_ONLY` params always go in the options object; `_self` is dropped; JSDoc is the
`DESCRIPTION` block; `@see` from `SEE ALSO` (already extracted by `packages/engine/modules/pymol/cmd.py:298-300`).
Emit `LITERAL1`/`LITERAL2`/`PYTHON`/`SECURE`-mode commands (`packages/engine/modules/pymol/keywords.py:19-21`,
`:144-147`, `:235`, `:238`, `:265`, `:275`, `:283`) into a separate `unsafe.ts` module so their
import is a visible, greppable decision.

**Step 4 — enums** emit as string-literal unions regenerated from the runtime dumps
(`SettingName` from `setting.index_dict`, `ColorName` from `get_color_indices`,
`CartoonType` from `viewing.cartoon_sc.keywords`, etc.).

**Step 5 — drift CI.** A test re-runs `extract.py` and fails if `api-schema.json` changed without
regeneration. This is the only defence against the backend and client silently diverging — and it
is the reason to generate rather than hand-write.

### 9.3 Runtime client shape

`packages/client/src/` implements this over `packages/protocol/src/envelope.ts`.

```ts
class PymolClient {
  call<T = unknown>(m: string, a?: unknown[], k?: Record<string, unknown>): Promise<T>;
  batch(calls: Call[]): Promise<unknown>;
  do(line: string): Promise<null>;                 // console only, always resolves null
  complete(line: string): Promise<CompleteResult>;
  usage(name: string): Promise<string>;
  help(name: string): Promise<string>;
  on<K extends Topic>(topic: K, cb: (v: TopicPayload[K]) => void): () => void;
  blob(id: string): Promise<Blob>;
}
```

Generated functions are thin wrappers over `client.call`, so the generated surface stays
dependency-free and tree-shakable; a React app that only imports `color` and `show` ships two
wrappers, not 404.

---

## 10. Constraints this area lives under

1. **`G->Option->pmgui` gates the feedback queue** (`packages/engine/layer1/Ortho.cpp:492-499`), so
   a bridge that boots without `pmgui` gets zero console output. The bridge enables it (§8.1).
2. **No change notifications exist at all** (`grep -r Notify layer0..layer5` gives 0 hits), so the
   whole event story is polling. §8.5 Tier 2 item 1 is what keeps that affordable: four integers
   instead of an O(objects) diff per tick.
3. **`cmd.do` swallows return values and exceptions** (`packages/engine/modules/pymol/parser.py:465-481`,
   `packages/engine/modules/pymol/commanding.py:441-475`), so anything built on the `do` path is blind to
   failure. That is why `do` is the console path only and UI actions take the typed `call` path.
4. **Both bundled bridges are unauthenticated.** `rpc.py:441` `register_instance(cmd)` plus
   `rpc.py:422-430` (no localhost binding) is remote code execution by design. `pymolhttpd`'s
   `127.0.` check (`:63-67`) does not stop a hostile web page in the user's own browser. The
   replacement ships a token, an `Origin` allow-list and a loopback peer check together.
5. **`LITERAL1`/`LITERAL2` commands `eval` user strings** (`alter`, `iterate`, `alter_state`,
   `iterate_state`, `label`, `alias`, `set_key` — `packages/engine/modules/pymol/keywords.py:16,19,21,144,145,147,257`).
   `pymolhttpd` dodged `label` by substituting `label2` (`:473`). Parity with the desktop app means
   an arbitrary-Python surface reachable from the browser; the transport is what bounds it, which
   is why §8.1 spends its security budget there rather than on a symbol deny-list.
6. **`prepare_call` does no type coercion** (`packages/engine/modules/pymol/parsing.py:329-421`); functions coerce
   internally and inconsistently. Sending a JSON number where PyMOL expected a string usually
   works but is untested across all 404 functions.
7. **Six type annotations in the entire API**, so generated types are largely heuristic. The
   override table and the CI drift check in §9 are what keep the long tail honest.
8. **`new_command` has zero callers** (`packages/engine/modules/pymol/commanding.py:722`). It is the intended
   modern path but is unexercised upstream.
9. **Threading.** `cmd` is protected by `lock_api`/`lockcm` (`packages/engine/modules/pymol/cmd.py:135-142`,
   `packages/engine/modules/pymol/locking.py`) and `cmd._get_feedback` can return `None` under contention
   (`packages/engine/modules/pymol/internal.py:605`). `_call_in_gui_thread` is a plain passthrough in the
   module singleton (`packages/engine/modules/pymol/cmd.py:164-165`) — Qt overrides it
   (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:1243-1251`). The bridge marshals everything that
   touches the engine onto one thread (`packages/bridge/tenmol_bridge/pump.py`).
10. **Deprecated stdlib usage in `pymolhttpd`** (`Event.isSet` `:490`/`:502`, `Thread.setDaemon`
    `:497`) breaks on newer Pythons regardless of anything this port does.
11. **The `.pwg` launch path** (`packages/engine/modules/pymol/importing.py:516-610`) is the only way `pymolhttpd`
    starts, so any workflow that depends on `.pwg` depends on `pymolhttpd`.
12. **`rpc.py` shadows `cmd.label` and `cmd.rotate`** (`packages/engine/modules/pymol/rpc.py:463-465`), so a
    client written against XML-RPC has the wrong semantics for those two.
