# Claude Code accounts

A tab-bar button and a side panel that show which Claude Code account each Herdr pane uses. The button carries the account's round avatar and name; clicking it slides open a 360 px panel with the accounts grouped as in use, signed in and needing a login, the panes that run Claude in each one, and a button to open a new tab or a fork of the session in another account.

<!-- Placeholder: run `cc-accounts demo on`, open the panel and save the screenshot as preview.png in this folder. -->

![Claude Code accounts](preview.png)

**What you see:**

The panel is a column of 360 px (min 300, max 600) on the right of the active tab, hidden at first, on the `chrome` color. Top to bottom:

- **Header,** 44 px: the `users` icon (18 px, `foreground`), the title `Claude accounts` (semibold, UI font size + 1), a pill (`selected` background, 8 px side padding, 10 px radius, UI font size - 1, `muted`) that reads `this pane · <account>` or `no Claude here`, and a 24 px close button with the `close` icon.
- **Numbers,** a strip with a 1 px `border` and a 10 px radius on the `chrome` color. One 58 px tall cell each for `Accounts`, `In use` and `Panes`, and a fourth, `Needs login`, in the `blocked` color, only while at least one account has no login. The figure is semibold, UI font size + 4; the label is UI font size - 1.
- **Sections,** in this order, each with a label in semibold UI font size - 2 and a count: `IN USE · n` in `working`, `SIGNED IN · n` in `muted`, `NEEDS LOGIN · n` in `blocked`. An empty section is not drawn. The account of the focused pane leads its section.
- **One row per account,** at least 46 px tall, 8 px outside margin, 10 px inside padding, 10 px gap, 8 px radius, `selected` background for the focused pane's account and `background` for the others. From the left: a round 24 px avatar with the account's initial (bold, `background` color) on one of the theme's `ansi1` to `ansi6`, picked by the name so the same account always has the same color; the name (medium, `foreground`) over a line in `muted`, the e-mail or `not logged in`; the pane count as `2 panes` or `1 pane`, in a 64 px right-aligned slot; a 14 px `check` on the focused pane's account; the action buttons, 24 px squares with a 6 px radius and a 14 px icon.
- **Pane list,** under a row, indented 52 px: one 26 px line per pane with a status dot of 8 px, `<space> › <tab>` (medium) and the folder's name in `dim` (the pane's title when it has no folder), and a 12 px `check` on the focused pane. The account of the focused pane starts open.
- **Footer,** separated by a 1 px `border`: the `info` icon and `A running process keeps its account. Switching opens a new process.`, and under it a `raised` box with `cc-accounts add <name>` in the terminal's font (`Menlo` when settings give none).
- **Error line,** above the footer only when the CLI failed, in `ansi1`.

The button is a 140 px block in the tab bar's row, on `chrome` with a 1 px `border` at the bottom. Inside it a 26 px control (6 px radius, 12 px text, 16 px avatar) shows the focused pane's account name next to its avatar, or the `users` icon and `Accounts` when the focused pane does not run a local Claude. While the panel is open the control has the `selected` background and `foreground` text; otherwise `chrome` and `muted`. Its tooltip is `<account>: <state>`, or the error.

The popup, opened by `ctrl-shift-a`, is the same header, sections and rows in a 340 px wide window, with no numbers strip and no footer. Its height is 60 px, plus 26 per section and 50 per account (plus 24 with an error line), up to 480; past that it scrolls. The pane list does not expand there: the pane count has a tooltip with one line per pane.

An optional chip, 160 px wide, can sit in any bar: 26 px tall, `surface` background, 1 px `border`, 13 px radius, a 20 px avatar, the account's name (13 px, semibold) and a 12 px `chevron-down`. It reads `no Claude` when the focused pane is not Claude, `...` while the account is not known yet and `?` on an error. Clicking it opens the popup.

**How it behaves:**

Every account is in one of four states, always written in words as well as in color:

| State                  | When                                                  | Row text                    |
| ---------------------- | ----------------------------------------------------- | --------------------------- |
| `in use · N panes`     | a Claude process of this computer runs in the account | `in use · 1 pane` and so on |
| `in use · needs login` | the same, but the account has no login                | in `blocked`                |
| `signed in`            | it has a login and no pane uses it                    | the e-mail                  |
| `needs login`          | it has no login and no pane uses it                   | `not logged in`             |

A pane counts as Claude when its foreground process is named `claude`, or when it is a `cc-accounts` script followed by `run` (the wrapper). A pane of another machine is left out. The pane's status dot uses the agent's status: `working`, `blocked`, `done` or `idle`, each in the theme's color of that name, and `dim` when the pane has none.

- **Reading.** One copy reads for all. The button, the panel, the chip and the popup are separate copies of the mod. A read runs `cc-accounts ls --json`, then one `cc-accounts which <pid>...` for every Claude pane and the focused one, and shares the answer through `setShared("cc-accounts.data")`, with a 15 second lock in `cc-accounts.lock` so only one copy runs the commands. A read starts when the focused pane or the set of Claude panes changes, and a 30 second timer reads again. A hidden panel runs nothing and reads as soon as it is shown. In `herdr-app check` nothing runs.
- **Buttons.** `plus` (tooltip `New tab`) runs `tab.new` with the argv `<cli> run <account>`. `fork` (tooltip `Continue here in a fork`) appears when the focused pane has a live session, the account is another one and it has a login; it runs `terminal.open` with `place: "right"`, the session's folder and the argv `<cli> run <account> --resume <session id> --fork-session`. An account that needs a login has only `log-in` (tooltip `Open a tab and run /login`), which opens the same tab as `plus`. No shell is involved: commands go as argv lists.
- **Pane count.** In the panel it is a button with a `chevron-right` or `chevron-down` that opens or closes the pane list, saved per account in `localStorage` under `cc-accounts.open`. Clicking a pane runs `space.select`, `tab.select` and `pane.focus`, in that order.
- **Button.** Clicking it runs `layout.toggle` on the node `cc-accounts-panel`. The panel's close button runs `layout.hide` on it.
- **Demo mode.** `cc-accounts demo on` makes `ls --json` answer `{"demo": true, "accounts": [...]}` with three sample accounts. The mod then draws sample panes and ignores the real ones, and a click does nothing. `cc-accounts demo off` ends it.

**Built from:**

- `mod.json`: `{ "place": "none", "title": "Claude Code accounts", "overlay": { "kind": "popup", "width": 340, "height": 300 } }`. Herdr docks nothing by itself; the layout and the key place it.
- `main.js` exports a `View` with the role in `props().role`: `toggle`, `panel`, `chip`, or `menu` (the popup, which is also what `mod.open` delivers). `model.js` holds what the mod decides without Herdr (which panes are Claude, the sections, the counts, the popup's height, the demo data).
- `keys.json`: `{ "global": { "ctrl-shift-a": "mod.open:cc-accounts" } }`, merged into the person's keys.
- Layout nodes, which the person's layout needs for the button and the panel: a block `{ "id": "cc-accounts-toggle", "type": "block", "size": { "px": 140 }, "content": { "mod": "cc-accounts", "props": { "role": "toggle" } } }` in the row that holds the `tabs` block, and a column `{ "id": "cc-accounts-panel", "type": "column", "hidden": true, "size": { "px": 360 }, "min": 300, "max": 600, "children": [{ "id": "cc-accounts", "type": "block", "content": { "mod": "cc-accounts", "props": { "role": "panel" } } }] }` right after the `{ "content": { "tab": "active" } }` block in its row. Without them the popup still works.
- Icons: nine SVGs in `icons/` (`users`, `plus`, `fork`, `log-in`, `info`, `close`, `check`, `chevron-right`, `chevron-down`), 24 x 24 viewBox, stroke `currentColor`, width 1.5, loaded with `svg("mods/cc-accounts/icons/<name>.svg")` and tinted with the text color.
- Modules: `gpui-kit` (`View`, `div`, `svg`), `gpui-base` (`v_flex`, `h_flex`) and `herdr` (`exec`, `terminals`, `panes`, `spaces`, `focused`, `run`, `props`, `openOverlay`, `closeOverlay`, `checking`, `theme`, `settings`, `home`, `appHome`, `readTextFile`, `layout`, `shared`, `setShared`). Theme tokens: `chrome`, `surface`, `raised`, `background`, `foreground`, `muted`, `dim`, `border`, `hover`, `selected`, `working`, `blocked`, `done`, `idle`, `ansi1` to `ansi6`.
- The CLI, `cc-accounts`, a Node script in this same folder (`cli.js` is its code). The mod runs it by `appHome() + "/mods/cc-accounts/cc-accounts"` and falls back to `cc-accounts` on the `PATH` when that file cannot start; the one that worked is used for `run`. Its commands: `ls [--json]`, `add`, `sync`, `run`, `which`, `demo`.
- Programs the mod runs: the CLI above, which runs `ps -E` and `pgrep -P` and, on macOS, `security find-generic-password -s <service> -a <user>` (only its exit code; never with `-w` or `-g`); and `pgrep -P <pid>` from the mod itself. Files it reads outside its folder: `~/.claude`, `~/.claude.json`, `~/.claude-accounts/*/.claude.json` and `~/.claude*/sessions/<pid>.json` (through `readTextFile`). The CLI writes under `~/.claude-accounts/`. The network is not used.

**Watch out:**

- **Tell the person before adding it:** the mod runs programs (`exec` of its own CLI, `ps`, `pgrep`, `security find-generic-password` without reading a value) and reads files outside its folder (`~/.claude`, `~/.claude.json`, `~/.claude-accounts`, the sessions of Claude). It never reads a credential, a token or a Keychain value.
- macOS is the supported system: `which` reads a process environment with `ps -E`, which has that form there; elsewhere it answers `unknown`.
- Render must not change shared state. Work that writes it starts after the render ends (`cx.spawn` runs its body up to the first `await` at once, so it sleeps for a tick first).
- Never keep a `cx` for later; every callback gets its own. No `setTimeout` or `setInterval`: use `cx.timer.every`. `init()` runs for real in `herdr-app check`, so guard `exec` and timers with `checking()`.
- An overlay cannot resize after it opens, so the popup's height is computed before `openOverlay`.
- The popup freezes the account and session of the pane it was opened from; the panel and the button follow the focused pane.
- The pane's pid can be the wrapper `cc-accounts run`, in front of Claude, because Node cannot `exec`. The account is read from the wrapper's `claude` child, never from its arguments, and the session file is looked up under the pid and its children.
- `signed in` only means that a Keychain item or a `.credentials.json` exists. An expired login still reads `signed in`.
- The button's 140 px was estimated: about twelve characters of a name fit before the ellipsis.
- A pane on another machine is not listed, and the account of a Claude that runs there is not known.
- Herdr's own layouts (`main`, `terminals`, `win98`) are replaced on every start, so put the two layout nodes in a layout of your own.
- Herdr writes `jsconfig.json` and `gpui-kit.d.ts` into this folder when it loads the mod. They are not part of it.

**Done when:**

- `herdr-app check mods/cc-accounts` exits 0.
- With `cc-accounts demo on`, `cc-accounts ls --json` prints `"demo": true` and the accounts `personal`, `client` and `work`, all with `@example.com` e-mails, and prints nothing of the real machine.
- In demo mode the open panel shows `Claude accounts` with the pill `this pane · work`, the numbers 3, 1, 2 and 1 (`Accounts`, `In use`, `Panes`, `Needs login`), the sections `IN USE · 1` (`work`, `2 panes`, a `working` dot on `api-server › claude` and a `blocked` dot on `web-app › claude`), `SIGNED IN · 1` (`personal`) and `NEEDS LOGIN · 1` (`client`, with only the `log-in` button).
- Clicking the button toggles the panel; the panel's close button hides it; `ctrl-shift-a` opens the popup with the same rows and no numbers.
- With a real Claude open in an account, its row moves to `IN USE` and counts the pane, and `cc-accounts which <pid>` prints that account.
- `plus` opens a tab running `cc-accounts run <account>`; `fork` opens a pane to the right that resumes the session with `--fork-session`.
- With the CLI's file removed from the folder and not on the `PATH`, the panel shows the error line `cc-accounts is not on PATH` and the button's tooltip shows it too.
