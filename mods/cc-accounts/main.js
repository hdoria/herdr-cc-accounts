// Claude Code accounts: shows which Claude Code account the focused pane uses, and opens tabs or panes in another one.
// props().role "chip": the focused pane's account name; clicking opens the popup.
// props().role "toggle": a tab-bar button that shows or hides the layout's "cc-accounts-panel" node.
// props().role "panel": the side panel with the accounts, filled while it is shown.
// props().role "menu" (or none, as mod.open delivers it): the popup listing the accounts.
// The data comes from the `cc-accounts` CLI that sits in this mod's folder (the PATH is the fallback);
// the mod never reads credentials or writes files.
// One copy reads for all: the result and a short lock live in shared state, so the button, the panel, the
// chip and the popup show the same data and run `cc-accounts ls` once between them.

/** @import { Cx, Element } from "gpui-kit" */
/** @import { Account, AccountGroup, AccountStatus, FocusedClaude, PaneItem, Session, View as AccountsView } from "./model.js" */

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  exec,
  terminals,
  panes,
  spaces,
  focused,
  run,
  props,
  openOverlay,
  closeOverlay,
  checking,
  theme,
  settings,
  home,
  appHome,
  readTextFile,
  layout,
  shared,
  setShared,
} from "herdr";
import {
  ACCOUNT_NAME,
  SESSION_ID,
  accountPanes,
  accountStatus,
  avatarSlot,
  claudePid,
  cliCandidates,
  countPanes,
  demoView,
  findNode,
  goToCommands,
  groupAccounts,
  initial,
  paneTooltip,
  parseListing,
  parseWhich,
  plural,
  popupHeight,
  readDue,
  readKey,
  stats,
  localAddress,
  ROW_HEIGHT,
} from "./model.js";

const REFRESH_MS = 30000;
const LOCK_MS = 15000;
const DATA_KEY = "cc-accounts.data";
const LOCK_KEY = "cc-accounts.lock";
const OPEN_KEY = "cc-accounts.open";
const PANEL_NODE = "cc-accounts-panel";
const LIVE_ROLES = ["chip", "toggle", "panel"];
const POPUP_WIDTH = 340;
const TIP = "A running process keeps its account. Switching opens a new process.";

/** @typedef {Record<string, string>} Theme */

/** @param {unknown} e */
const errorMessage = (e) => (typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e));

// Runs the CLI, trying the copy in this mod's folder first. `known` is the one that worked on the last read.
/**
 * @param {string[]} args
 * @param {string | null} known
 * @returns {Promise<{ cli: string, result: import("herdr").ExecResult }>}
 */
async function cliExec(args, known) {
  /** @type {unknown} */
  let failure;
  for (const cli of known ? [known] : cliCandidates(appHome())) {
    try {
      return { cli, result: await exec(cli, args) };
    } catch (e) {
      failure = e;
    }
  }
  throw failure;
}

/**
 * @param {unknown} _e
 * @param {Cx} cx
 */
const stop = (_e, cx) => cx.stop_propagation();
const mono = () => settings()?.font_family || "Menlo";

// Work started from render: cx.spawn runs its body up to the first await at once, and shared state must not
// change while a view renders, so the work starts after the render ends.
/**
 * @param {Cx} cx
 * @param {(cx: Cx) => Promise<void>} fn
 */
const later = (cx, fn) =>
  cx.spawn(async (cx) => {
    await cx.sleep(0);
    return fn(cx);
  });

function sizes() {
  const base = Number(settings()?.ui_font_size) || 13;
  return { title: base + 1, body: base + 0.5, secondary: base - 0.5, label: base - 1, number: base + 4 };
}

// ---- Parts shared by the button, the panel, the chip and the popup ----

/**
 * @param {string} name
 * @param {number} size
 * @param {string} color
 */
const icon = (name, size, color) => svg(`mods/cc-accounts/icons/${name}.svg`).size(size).flex_none().text_color(color);

// A round avatar with the account's initial, in a color the name picks among the theme's ansi1..ansi6.
/**
 * @param {Theme} t
 * @param {string} name
 * @param {number} size
 */
function avatar(t, name, size) {
  return div()
    .size(size)
    .flex_none()
    .rounded_full()
    .bg(t[`ansi${avatarSlot(name)}`])
    .flex()
    .items_center()
    .justify_center()
    .text_size(Math.round(size * 0.58))
    .font_bold()
    .text_color(t.background)
    .child(initial(name));
}

/** @param {string} color */
const dot = (color) => div().size(8).flex_none().rounded_full().bg(color);

/**
 * @param {Theme} t
 * @param {string} id
 * @param {string} name
 * @param {string} tip
 * @param {(event: unknown, cx: Cx) => void} onClick
 */
function iconButton(t, id, name, tip, onClick) {
  return h_flex()
    .id(id)
    .size(24)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(6)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .active((s) => s.bg(t.selected))
    .tooltip(tip)
    .on_mouse_down("left", stop)
    .on_click(onClick)
    .child(icon(name, 14, t.muted));
}

/**
 * @param {Theme} t
 * @param {AccountGroup} section
 */
function sectionLabel(t, section) {
  return div()
    .flex_none()
    .px(10)
    .pt(12)
    .pb(4)
    .text_size(sizes().label - 1)
    .font_semibold()
    .text_color(t[section.color])
    .child(`${section.title} · ${section.items.length}`);
}

// The title row of the panel and the popup: icon, title, a context chip and a close button.
/**
 * @param {Theme} t
 * @param {string} chip
 * @param {(event: unknown, cx: Cx) => void} onClose
 */
function header(t, chip, onClose) {
  const s = sizes();
  return h_flex()
    .h(44)
    .flex_none()
    .pl(14)
    .pr(8)
    .gap(8)
    .items_center()
    .child(icon("users", 18, t.foreground))
    .child(div().flex_none().text_size(s.title).font_semibold().child("Claude accounts"))
    .child(
      div()
        .min_w(0)
        .truncate()
        .px(8)
        .py(2)
        .rounded(10)
        .bg(t.selected)
        .text_size(s.label)
        .text_color(t.muted)
        .child(chip),
    )
    .child(div().flex_1())
    .child(
      h_flex()
        .id("close")
        .size(24)
        .flex_none()
        .justify_center()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .hover((x) => x.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(onClose)
        .child(icon("close", 14, t.muted)),
    );
}

// The numbers: one card each, the figure large and its label below. Needs login only when there is one.
/**
 * @param {Theme} t
 * @param {ReturnType<typeof stats>} st
 */
function statStrip(t, st) {
  const s = sizes();
  /** @type {[string, number, string | null][]} */
  const cells = [
    ["Accounts", st.accounts, null],
    ["In use", st.inUse, null],
    ["Panes", st.panes, null],
  ];
  if (st.needsLogin > 0) cells.push(["Needs login", st.needsLogin, t.blocked]);
  return h_flex()
    .flex_none()
    .rounded(10)
    .overflow_hidden()
    .border_1()
    .border_color(t.border)
    .bg(t.chrome)
    .children(
      cells.map(([label, n, color], i) =>
        v_flex()
          .id(`stat-${i}`)
          .flex_1()
          .min_w(0)
          .h(58)
          .gap(3)
          .items_center()
          .justify_center()
          .when(i > 0, (el) => el.border_l(1).border_color(t.border))
          .child(
            div()
              .text_size(s.number)
              .font_semibold()
              .text_color(color ?? (n ? t.foreground : t.muted))
              .child(String(n)),
          )
          .child(
            div()
              .text_size(s.label)
              .text_color(color ?? t.muted)
              .child(label),
          ),
      ),
    );
}

/** @param {AccountsView} v */
const chipText = (v) => (v.current ? `this pane · ${v.current}` : "no Claude here");

export default class ClaudeCodeAccounts extends View {
  /**
   * @param {unknown} _props
   * @param {Cx} cx
   */
  init(_props, cx) {
    const p = props() ?? {};
    /** @type {string} */
    this.role = p.role ?? "menu";
    /** @type {Record<string, boolean>} */
    this.open = this.loadOpen();
    // herdr-app check runs init for real: no exec or timer may start there.
    if (checking()) return;
    if (LIVE_ROLES.includes(this.role)) cx.timer.every(REFRESH_MS, (cx) => this.timerRead(cx));
  }

  // ---- What the mod knows right now ----

  // The panel node's hidden flag lives in the layout. A panel block with no such node (another layout) counts as shown.
  panelHidden() {
    return Boolean(findNode(layout(), PANEL_NODE)?.hidden);
  }

  // The focused terminal when it runs Claude locally: the accounts and the CLI live on this computer.
  /** @returns {FocusedClaude | null} */
  focus() {
    const f = focused();
    const address = f?.terminal ?? f?.agent;
    if (!localAddress(address)) return null;
    const t = terminals().find((x) => x.address === address);
    const pid = t ? claudePid(t) : null;
    return pid === null ? null : { pid, cwd: f.cwd ?? null };
  }

  // The pids of every local pane whose foreground process is Claude, each once.
  /** @returns {number[]} */
  claudePids() {
    return [
      ...new Set(
        terminals()
          .filter((t) => localAddress(t.address))
          .map(claudePid)
          .filter((pid) => pid !== null),
      ),
    ];
  }

  // Everything a role draws, from shared state (or from props when no read has landed: a popup's first
  // frame, and the fixed props of herdr-app check). props.current and props.session only come from the popup,
  // which freezes what the pane it was opened from had.
  /** @returns {AccountsView} */
  view() {
    const p = props() ?? {};
    const d = shared(DATA_KEY);
    const focus = this.focus();
    if (!d) {
      return {
        accounts: p.accounts ?? [],
        counts: p.counts ?? {},
        current: p.current ?? null,
        session: p.session ?? null,
        error: p.error ?? null,
        panesOf: {},
        focus,
      };
    }
    if (d.demo) return demoView(d.accounts ?? []);
    const byPid = d.byPid ?? {};
    const panesOf =
      this.role === "panel" || this.role === "menu"
        ? accountPanes({ terminals: terminals(), panes: panes(), spaces: spaces(), byPid, focus: focused() })
        : {};
    return {
      accounts: d.accounts ?? [],
      counts: countPanes(terminals(), byPid),
      current: p.current ?? (focus ? (byPid[String(focus.pid)] ?? null) : null),
      session: p.session ?? (focus && d.focusPid === focus.pid ? d.session : null),
      error: d.error ?? null,
      panesOf,
      focus,
    };
  }

  // ---- Reading: one copy at a time ----

  // Starts a read when the focus or the Claude panes changed, or the data aged out. A panel that is hidden
  // runs no command; the button's copy keeps the data fresh.
  /** @param {Cx} cx */
  sync(cx) {
    const focus = this.focus();
    if (checking() || (this.role === "panel" && this.panelHidden())) return focus;
    if (this.role === "menu" && shared(DATA_KEY)) return focus;
    if (readDue(shared(DATA_KEY), readKey(focus?.pid, this.claudePids()), Date.now(), REFRESH_MS))
      void later(cx, (cx) => this.read(cx, REFRESH_MS));
    return focus;
  }

  /** @param {Cx} cx */
  timerRead(cx) {
    if (checking() || (this.role === "panel" && this.panelHidden())) return null;
    return this.read(cx, REFRESH_MS / 2);
  }

  // Whoever takes the lock reads; the others see the lock and leave. A lock older than LOCK_MS belongs to a copy
  // that closed mid-read.
  claim() {
    const lock = shared(LOCK_KEY);
    if (lock && Date.now() - lock.at < LOCK_MS) return false;
    setShared(LOCK_KEY, { at: Date.now() });
    return true;
  }

  // Reads the accounts (unless a recent read has them), the Claude panes' accounts and the focused pane's session.
  /**
   * @param {Cx} _cx
   * @param {number} maxAge
   */
  async read(_cx, maxAge) {
    if (checking()) return;
    const focus = this.focus();
    const pids = this.claudePids();
    const key = readKey(focus?.pid, pids);
    const before = shared(DATA_KEY);
    if (!readDue(before, key, Date.now(), maxAge) || !this.claim()) return;
    let accounts = before?.accounts ?? [];
    let accountsAt = before?.accountsAt ?? 0;
    let demo = before?.demo ?? false;
    let cli = before?.cli ?? null;
    /** @type {Record<string, string>} */
    let byPid = {};
    let session = null;
    let error = null;
    try {
      if (Date.now() - accountsAt >= REFRESH_MS || before?.error) {
        const ls = await cliExec(["ls", "--json"], cli);
        if (ls.result.code !== 0) throw new Error(ls.result.stderr.trim() || "cc-accounts ls failed");
        ({ accounts, demo } = parseListing(ls.result.stdout));
        cli = ls.cli;
        accountsAt = Date.now();
      }
      // In demo mode the panes of this computer are neither asked about nor shown.
      if (!demo) {
        // One call resolves every Claude pane. It exits 1 when a pid vanished meanwhile; its other lines still count.
        const ask = focus && !pids.includes(focus.pid) ? [...pids, focus.pid] : pids;
        if (ask.length > 0) byPid = parseWhich((await exec(cli, ["which", ...ask.map(String)])).stdout, accounts);
        if (focus) session = await this.findSession(focus, accounts, byPid[String(focus.pid)] ?? null);
      }
    } catch (e) {
      accounts = [];
      accountsAt = 0;
      demo = false;
      cli = null;
      error = /ENOENT|not found|127/i.test(errorMessage(e)) ? "cc-accounts is not on PATH" : errorMessage(e);
    }
    setShared(DATA_KEY, {
      accounts,
      accountsAt,
      demo,
      cli,
      byPid,
      session,
      focusPid: focus?.pid ?? null,
      error,
      key,
      at: Date.now(),
    });
    setShared(LOCK_KEY, null);
  }

  // Claude writes sessions/<pid>.json inside its own account folder. The pane's pid may be the
  // `cc-accounts run` wrapper in front of claude, so its direct children are tried too.
  /**
   * @param {FocusedClaude} focus
   * @param {Account[]} accounts
   * @param {string | null} current
   * @returns {Promise<Session | null>}
   */
  async findSession(focus, accounts, current) {
    const account = accounts.find((a) => a.name === current);
    if (!account) return null;
    const dir = account.dir ?? `${home()}/.claude`;
    const children = await exec("pgrep", ["-P", String(focus.pid)]).catch(() => ({ stdout: "" }));
    const candidates = [
      focus.pid,
      ...children.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d+$/.test(l)),
    ];
    for (const pid of candidates) {
      const text = await readTextFile(`${dir}/sessions/${pid}.json`).catch(() => /** @type {string | null} */ (null));
      if (!text) continue;
      try {
        const { sessionId, cwd } = JSON.parse(text);
        if (SESSION_ID.test(sessionId ?? "") && typeof cwd === "string" && cwd.startsWith("/"))
          return { id: sessionId, cwd };
      } catch {
        // a session file that is not JSON is skipped
      }
    }
    return null;
  }

  // ---- Actions ----

  closePopup() {
    const overlay = props()?.overlay;
    if (overlay !== undefined && overlay !== null) closeOverlay(overlay);
  }

  // The command that opens Claude in an account: the CLI that answered the last read, else the one in the mod's folder.
  cliCommand() {
    return shared(DATA_KEY)?.cli ?? cliCandidates(appHome())[0];
  }

  // Demo accounts and panes are samples: clicking them does nothing.
  demo() {
    return Boolean(shared(DATA_KEY)?.demo);
  }

  /** @param {string} name */
  newTab(name) {
    if (!ACCOUNT_NAME.test(name) || this.demo()) return;
    this.closePopup();
    run("tab.new", { argv: [this.cliCommand(), "run", name] });
  }

  // The focused pane keeps running in its own account. --fork-session gives the copy its own session id,
  // so two live Claude processes never write to the same conversation.
  /**
   * @param {string} name
   * @param {Session | null} session
   */
  continueHere(name, session) {
    if (!ACCOUNT_NAME.test(name) || !session || !SESSION_ID.test(session.id) || this.demo()) return;
    this.closePopup();
    run("terminal.open", {
      place: "right",
      folder: session.cwd,
      argv: [this.cliCommand(), "run", name, "--resume", session.id, "--fork-session"],
    });
  }

  // The same as a new tab; the button's tooltip tells the user to run /login once Claude is open.
  /** @param {string} name */
  logIn(name) {
    this.newTab(name);
  }

  togglePanel() {
    run("layout.toggle", { id: PANEL_NODE });
  }

  // Takes the user to a pane: its space, then its tab, then the pane.
  /** @param {PaneItem} item */
  goTo(item) {
    if (this.demo()) return;
    for (const [command, args] of goToCommands(item)) run(command, args);
  }

  /** @param {AccountsView} v */
  openPopup(v) {
    const sections = groupAccounts(v.accounts, v.counts, v.current);
    openOverlay({
      mod: "cc-accounts",
      kind: "popup",
      width: POPUP_WIDTH,
      height: popupHeight(sections, v.error),
      props: {
        role: "menu",
        accounts: v.accounts,
        current: v.current,
        session: v.session,
        counts: v.counts,
        error: v.error,
      },
    });
  }

  // ---- Which accounts show their panes: saved per account, the focused pane's account starts open ----

  loadOpen() {
    try {
      const value = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  /**
   * @param {string} name
   * @param {boolean} here
   */
  isOpen(name, here) {
    return Object.hasOwn(this.open, name) ? Boolean(this.open[name]) : here;
  }

  /**
   * @param {string} name
   * @param {boolean} here
   * @param {Cx} cx
   */
  toggleOpen(name, here, cx) {
    this.open = { ...this.open, [name]: !this.isOpen(name, here) };
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(this.open));
    } catch {
      // the choice then lasts until the view closes
    }
    cx.notify();
  }

  // ---- Drawing ----

  /** @param {AccountsView} v */
  toggleTip(v) {
    if (v.error) return v.error;
    const account = v.current ? v.accounts.find((a) => a.name === v.current) : null;
    return account
      ? `${account.name}: ${accountStatus(account, v.counts[account.name] ?? 0).label}`
      : "Claude Code accounts";
  }

  /**
   * @param {Cx} cx
   * @returns {Element}
   */
  toggle(cx) {
    this.sync(cx);
    const v = this.view();
    const t = theme();
    const node = findNode(layout(), PANEL_NODE);
    const on = Boolean(node) && !node.hidden;
    const name = v.current && !v.error ? v.current : null;
    return h_flex()
      .size_full()
      .pr(10)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("cc-accounts-toggle")
          .h(26)
          .px(8)
          .gap(6)
          .flex_1()
          .min_w(0)
          .items_center()
          .rounded(6)
          .text_size(12)
          .bg(on ? t.selected : t.chrome)
          .text_color(on ? t.foreground : t.muted)
          .hover((s) => s.bg(t.hover))
          .cursor_pointer()
          .on_mouse_down("left", stop)
          .on_click(() => this.togglePanel())
          .tooltip(this.toggleTip(v))
          .child(name ? avatar(t, name, 16) : icon("users", 16, on ? t.foreground : t.muted))
          .child(
            div()
              .min_w(0)
              .truncate()
              .child(name ?? "Accounts"),
          ),
      );
  }

  /**
   * @param {Cx} cx
   * @returns {Element}
   */
  chip(cx) {
    this.sync(cx);
    const v = this.view();
    const t = theme();
    const label = v.error ? "?" : v.focus ? (v.current ?? "...") : "no Claude";
    return h_flex()
      .id("accounts-chip")
      .h(26)
      .flex_none()
      .items_center()
      .gap(6)
      .pl(3)
      .pr(10)
      .rounded(13)
      .bg(t.surface)
      .border(1)
      .border_color(t.border)
      .cursor_pointer()
      .hover((h) => h.bg(t.hover))
      .tooltip(v.error ?? "Claude Code accounts")
      .on_click(() => this.openPopup(v))
      .child(avatar(t, label, 20))
      .child(
        div()
          .text_size(13)
          .font_semibold()
          .text_color(v.focus ? t.foreground : t.muted)
          .child(label),
      )
      .child(icon("chevron-down", 12, t.muted));
  }

  // One account: avatar, name over email, the pane count, a check on the focused pane's account and the actions.
  // expandable: the panel, where the count opens the list of panes. The popup shows that list as the count's tooltip.
  /**
   * @param {Theme} t
   * @param {Account} a
   * @param {AccountsView} v
   * @param {boolean} expandable
   * @returns {Element}
   */
  accountRow(t, a, v, expandable) {
    const s = sizes();
    const here = a.name === v.current;
    const st = accountStatus(a, v.counts[a.name] ?? 0);
    const items = v.panesOf[a.name] ?? [];
    const open = expandable && items.length > 0 && this.isOpen(a.name, here);
    const sub =
      st.key === "in use" && st.needsLogin
        ? div().truncate().text_size(s.label).text_color(t.blocked).child(st.label)
        : div()
            .truncate()
            .text_size(s.label)
            .text_color(t.muted)
            .child(a.email ?? "not logged in");
    const count = st.panes > 0 ? this.paneCount(t, a, st, items, expandable, open, here) : div().w(64).flex_none();
    const row = h_flex()
      .id(`row-${a.name}`)
      .min_h(ROW_HEIGHT - 4)
      .mx(8)
      .px(10)
      .py(6)
      .gap(10)
      .items_center()
      .rounded(8)
      .bg(here ? t.selected : t.background)
      .hover((x) => x.bg(here ? t.selected : t.hover))
      .child(avatar(t, a.name, 24))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(1)
          .child(div().truncate().text_size(s.body).font_medium().text_color(t.foreground).child(a.name))
          .child(sub),
      )
      .child(count)
      .child(
        div()
          .w(14)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .children(here ? [icon("check", 14, t.foreground)] : []),
      )
      .child(
        h_flex()
          .flex_none()
          .gap(2)
          .children(this.actions(t, a, st, here, v)),
      );
    return v_flex()
      .id(`account-${a.name}`)
      .flex_none()
      .child(row)
      .when(open, (el) =>
        el.child(
          v_flex()
            .id(`panes-of-${a.name}`)
            .ml(52)
            .mr(8)
            .mb(4)
            .gap(1)
            .children(items.map((item) => this.paneItem(t, item))),
        ),
      );
  }

  /**
   * @param {Theme} t
   * @param {Account} a
   * @param {AccountStatus} st
   * @param {PaneItem[]} items
   * @param {boolean} expandable
   * @param {boolean} open
   * @param {boolean} here
   * @returns {Element}
   */
  paneCount(t, a, st, items, expandable, open, here) {
    const s = sizes();
    const text = div().flex_none().text_size(s.label).text_color(t.muted).child(plural(st.panes, "pane"));
    if (!expandable || items.length === 0) {
      return h_flex()
        .id(`count-${a.name}`)
        .w(64)
        .flex_none()
        .justify_end()
        .tooltip(paneTooltip(items) || plural(st.panes, "pane"))
        .child(text);
    }
    return h_flex()
      .id(`count-${a.name}`)
      .h(24)
      .w(64)
      .flex_none()
      .px(4)
      .gap(3)
      .items_center()
      .justify_end()
      .rounded(6)
      .cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .tooltip(open ? "Hide the panes" : "Show the panes")
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.toggleOpen(a.name, here, cx))
      .child(text)
      .child(icon(open ? "chevron-down" : "chevron-right", 12, t.muted));
  }

  // A pane that runs Claude in the account: its status dot, where it is and what it works on. A click goes there.
  /**
   * @param {Theme} t
   * @param {PaneItem} item
   * @returns {Element}
   */
  paneItem(t, item) {
    const s = sizes();
    const color = { working: t.working, blocked: t.blocked, done: t.done, idle: t.idle }[item.status] ?? t.dim;
    return h_flex()
      .id(`pane-${item.terminal}`)
      .h(26)
      .px(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .bg(item.focused ? t.selected : t.background)
      .hover((x) => x.bg(item.focused ? t.selected : t.hover))
      .tooltip(item.status ? `${item.where} · ${item.status}` : item.where)
      .on_mouse_down("left", stop)
      .on_click(() => this.goTo(item))
      .child(dot(color))
      .child(div().min_w(0).truncate().text_size(s.label).font_medium().text_color(t.foreground).child(item.where))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(s.label - 1)
          .text_color(t.dim)
          .child(item.detail),
      )
      .when(item.focused, (el) => el.child(icon("check", 12, t.muted)));
  }

  /**
   * @param {Theme} t
   * @param {Account} a
   * @param {AccountStatus} st
   * @param {boolean} here
   * @param {AccountsView} v
   * @returns {Element[]}
   */
  actions(t, a, st, here, v) {
    if (st.needsLogin)
      return [iconButton(t, `login-${a.name}`, "log-in", "Open a tab and run /login", () => this.logIn(a.name))];
    const out = [iconButton(t, `tab-${a.name}`, "plus", "New tab", () => this.newTab(a.name))];
    if (v.session && !here)
      out.push(
        iconButton(t, `continue-${a.name}`, "fork", "Continue here in a fork", () =>
          this.continueHere(a.name, v.session),
        ),
      );
    return out;
  }

  /**
   * @param {Theme} t
   * @param {AccountsView} v
   * @returns {Element}
   */
  errorLine(t, v) {
    return div().flex_none().px(14).py(4).text_size(sizes().label).text_color(t.ansi1).child(v.error);
  }

  /**
   * @param {Theme} t
   * @param {AccountsView} v
   * @param {boolean} expandable
   * @returns {Element[]}
   */
  sections(t, v, expandable) {
    return groupAccounts(v.accounts, v.counts, v.current).flatMap((section) => [
      sectionLabel(t, section),
      ...section.items.map((a) => this.accountRow(t, a, v, expandable)),
    ]);
  }

  /**
   * @param {Cx} cx
   * @returns {Element}
   */
  menu(cx) {
    if (!checking()) this.sync(cx);
    const v = this.view();
    const t = theme();
    return v_flex()
      .id("accounts-menu")
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .text_color(t.foreground)
      .child(header(t, chipText(v), () => this.closePopup()))
      .child(
        v_flex()
          .id("accounts-menu-list")
          .flex_1()
          .min_h(0)
          .pb(8)
          .overflow_y_scroll()
          .children(this.sections(t, v, false)),
      )
      .when(Boolean(v.error), (el) => el.child(this.errorLine(t, v)));
  }

  /**
   * @param {Cx} cx
   * @returns {Element}
   */
  panel(cx) {
    this.sync(cx);
    const v = this.view();
    const t = theme();
    const s = sizes();
    return v_flex()
      .id("accounts-panel")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .text_size(s.body)
      .child(header(t, chipText(v), () => run("layout.hide", { id: PANEL_NODE })))
      .child(
        div()
          .flex_none()
          .px(14)
          .pb(12)
          .border_b(1)
          .border_color(t.border)
          .child(statStrip(t, stats(v.accounts, v.counts))),
      )
      .child(
        v_flex()
          .id("accounts-panel-list")
          .flex_1()
          .min_h(0)
          .pb(8)
          .overflow_y_scroll()
          .children(this.sections(t, v, true)),
      )
      .when(Boolean(v.error), (el) => el.child(this.errorLine(t, v)))
      .child(
        v_flex()
          .flex_none()
          .px(14)
          .py(10)
          .gap(8)
          .border_t(1)
          .border_color(t.border)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(icon("info", 14, t.muted))
              .child(div().flex_1().min_w(0).text_size(s.label).text_color(t.muted).child(TIP)),
          )
          .child(
            div()
              .px(8)
              .py(4)
              .rounded(6)
              .bg(t.raised)
              .font_family(mono())
              .text_size(s.label)
              .text_color(t.foreground)
              .child("cc-accounts add <name>"),
          ),
      );
  }

  /**
   * @param {Cx} cx
   * @returns {Element}
   */
  render(cx) {
    if (this.role === "chip") return this.chip(cx);
    if (this.role === "toggle") return this.toggle(cx);
    if (this.role === "panel") return this.panel(cx);
    return this.menu(cx);
  }
}
