// What the cc-accounts mod decides without touching Herdr: which panes run Claude, how accounts are grouped,
// which panes use which account and what a click on one does. main.js only draws and runs commands.

/**
 * @typedef {object} Account
 * @property {string} name
 * @property {string} [dir]
 * @property {string | null} [email]
 * @property {boolean} [signedIn]
 */

/**
 * @typedef {object} Terminal
 * @property {string} address
 * @property {{ name?: string, argv?: string[] | string | null, pid?: number } | null} [foreground]
 */

/** @typedef {"working" | "blocked" | "done" | "idle"} PaneStatus */

/**
 * @typedef {object} Pane
 * @property {string} pane
 * @property {string | null} terminal
 * @property {string} tab
 * @property {string} title
 * @property {string | null} cwd
 * @property {PaneStatus | null} status
 */

/**
 * @typedef {object} Space
 * @property {string} id
 * @property {string} name
 * @property {string | null} machine
 * @property {{ id: string, name: string }[]} tabs
 */

/**
 * @typedef {object} LayoutNode
 * @property {string} [id]
 * @property {boolean} [hidden]
 * @property {LayoutNode[]} [children]
 */

/**
 * @typedef {object} PaneItem
 * @property {string} terminal
 * @property {string} pane
 * @property {string} tab
 * @property {string} space
 * @property {string} where
 * @property {string} detail
 * @property {PaneStatus | null} status
 * @property {boolean} focused
 */

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} cwd
 */

/**
 * @typedef {object} FocusedClaude
 * @property {number} pid
 * @property {string | null} cwd
 */

/**
 * @typedef {object} View
 * @property {Account[]} accounts
 * @property {Record<string, number>} counts
 * @property {string | null} current
 * @property {Session | null} session
 * @property {string | null} error
 * @property {Record<string, PaneItem[]>} panesOf
 * @property {FocusedClaude | null} focus
 */

/**
 * @typedef {object} AccountStatus
 * @property {"in use" | "signed in" | "needs login"} key
 * @property {number} panes
 * @property {boolean} needsLogin
 * @property {string} label
 */

/**
 * @typedef {object} Section
 * @property {AccountStatus["key"]} key
 * @property {string} title
 * @property {string} color
 */

/** @typedef {Section & { items: Account[] }} AccountGroup */

export const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]*$/;
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {number} n
 * @param {string} word
 */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const MOD_FOLDER = "mods/cc-accounts";

// The CLI sits in the mod's own folder, so installing the folder installs it. The PATH is the fallback for a
// copy kept under another name.
/** @param {string} appHome */
export const cliCandidates = (appHome) => [`${appHome}/${MOD_FOLDER}/cc-accounts`, "cc-accounts"];

// What `cc-accounts ls --json` answers: { demo, accounts }. An older CLI answered the bare list.
/**
 * @param {string} text
 * @returns {{ demo: boolean, accounts: Account[] }}
 */
export function parseListing(text) {
  const value = JSON.parse(text);
  const list = Array.isArray(value) ? value : value?.accounts;
  if (!Array.isArray(list)) throw new Error("cc-accounts ls answered something that is not a list of accounts");
  return {
    demo: !Array.isArray(value) && value.demo === true,
    accounts: list.filter((a) => ACCOUNT_NAME.test(a?.name ?? "")),
  };
}

/** @param {unknown} value */
const base = (value) =>
  String(value ?? "")
    .split("/")
    .pop();

// The pid of the pane's foreground process when it is Claude itself or the `cc-accounts run` wrapper in front
// of it, else null. Only the executable's name counts, never an argument: `vim ~/.claude/settings.json`,
// `less claude.log` and `cc-accounts ls` are not Claude. Program and terminal names outlive a Claude that
// already exited, so only the foreground process is read.
/**
 * @param {Terminal | null | undefined} terminal
 * @returns {number | null}
 */
export function claudePid(terminal) {
  const fg = terminal?.foreground;
  if (!fg || fg.pid === undefined || !Number.isInteger(fg.pid)) return null;
  const argv = Array.isArray(fg.argv)
    ? fg.argv.map(String)
    : fg.argv === undefined || fg.argv === null
      ? []
      : [String(fg.argv)];
  const claude = base(fg.name) === "claude" || base(argv[0]) === "claude";
  const wrapper = base(argv[1]) === "cc-accounts" && argv[2] === "run";
  return claude || wrapper ? fg.pid : null;
}

// "<pid> <account>" lines to an object of pid to account name; "unknown" and anything not listed is left out.
/**
 * @param {string | null | undefined} text
 * @param {Account[]} accounts
 * @returns {Record<string, string>}
 */
export function parseWhich(text, accounts) {
  const known = new Set(accounts.map((a) => a.name));
  /** @type {Record<string, string>} */
  const byPid = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = /^(\d+) (\S+)$/.exec(line.trim());
    if (m && known.has(m[2])) byPid[m[1]] = m[2];
  }
  return byPid;
}

/** @param {string | null | undefined} address */
export const localAddress = (address) => Boolean(address) && !String(address).includes("/");

// Panes per account from the pids the last read resolved and the terminals that are Claude right now.
/**
 * @param {Terminal[]} terminals
 * @param {Record<string, string>} byPid
 */
export function countPanes(terminals, byPid) {
  /** @type {Record<string, number>} */
  const counts = {};
  const seen = new Set();
  for (const t of terminals) {
    const pid = localAddress(t.address) ? claudePid(t) : null;
    if (pid === null || seen.has(pid)) continue;
    seen.add(pid);
    const name = byPid[String(pid)];
    if (name) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

// The three states. A pane running Claude in an account wins: the account is in use, with or without a login,
// and says so. Only `signedIn: true` counts as a login; an old CLI that omits the field does not claim it.
/**
 * @param {Account} account
 * @param {number} [panes]
 * @returns {AccountStatus}
 */
export function accountStatus(account, panes = 0) {
  const needsLogin = account.signedIn !== true;
  if (panes > 0) {
    return {
      key: "in use",
      panes,
      needsLogin,
      label: needsLogin ? "in use · needs login" : `in use · ${plural(panes, "pane")}`,
    };
  }
  return needsLogin
    ? { key: "needs login", panes: 0, needsLogin, label: "needs login" }
    : { key: "signed in", panes: 0, needsLogin, label: "signed in" };
}

// Section order, title and the theme color of its label.
/** @type {Section[]} */
export const SECTIONS = [
  { key: "in use", title: "IN USE", color: "working" },
  { key: "signed in", title: "SIGNED IN", color: "muted" },
  { key: "needs login", title: "NEEDS LOGIN", color: "blocked" },
];

// Accounts grouped by state, empty sections left out. The focused pane's account leads its section and the
// CLI's order holds for the rest.
/**
 * @param {Account[]} accounts
 * @param {Record<string, number>} counts
 * @param {string | null} current
 * @returns {AccountGroup[]}
 */
export function groupAccounts(accounts, counts, current) {
  return SECTIONS.map((section) => ({
    ...section,
    items: accounts
      .filter((a) => accountStatus(a, counts[a.name] ?? 0).key === section.key)
      .map((a, i) => /** @type {[Account, number]} */ ([a, i]))
      .sort(([a, i], [b, j]) => Number(b.name === current) - Number(a.name === current) || i - j)
      .map(([a]) => a),
  })).filter((section) => section.items.length > 0);
}

/**
 * @param {Account[]} accounts
 * @param {Record<string, number>} counts
 */
export function stats(accounts, counts) {
  const states = accounts.map((a) => accountStatus(a, counts[a.name] ?? 0));
  return {
    accounts: accounts.length,
    inUse: states.filter((s) => s.key === "in use").length,
    panes: accounts.reduce((sum, a) => sum + (counts[a.name] ?? 0), 0),
    needsLogin: states.filter((s) => s.needsLogin).length,
  };
}

/** @param {string | null | undefined} name */
export const initial = (name) => [...(name || "?")][0]?.toUpperCase() ?? "?";

// A stable theme color slot (ansi1..ansi6) per account name: FNV-1a of the name.
/** @param {string} name */
export function avatarSlot(name) {
  let h = 2166136261;
  for (const ch of String(name)) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 6) + 1;
}

export const ROW_HEIGHT = 50;
export const SECTION_HEIGHT = 26;
export const POPUP_CHROME = 44 + 16;
export const MAX_POPUP_HEIGHT = 480;

// An overlay cannot resize after opening, so the height is computed up front. Past the cap the list scrolls.
/**
 * @param {{ items: unknown[] }[]} sections
 * @param {string | null} error
 */
export function popupHeight(sections, error) {
  const rows = sections.reduce((n, s) => n + s.items.length, 0);
  const body = POPUP_CHROME + sections.length * SECTION_HEIGHT + rows * ROW_HEIGHT + (error ? 24 : 0);
  return Math.min(MAX_POPUP_HEIGHT, body);
}

/**
 * @param {LayoutNode | null | undefined} node
 * @param {string} id
 * @returns {LayoutNode | null}
 */
export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The key a read answers for: the focused pid and every Claude pid. A read is due when it changes or ages out.
/**
 * @param {number | null | undefined} focusPid
 * @param {Iterable<number>} pids
 */
export const readKey = (focusPid, pids) => `${focusPid ?? ""}|${[...pids].sort((a, b) => a - b).join(",")}`;
/**
 * @param {{ key: string, at: number } | null | undefined} data
 * @param {string} key
 * @param {number} now
 * @param {number} maxAge
 */
export const readDue = (data, key, now, maxAge) => !data || data.key !== key || now - data.at > maxAge;

/**
 * @param {string} text
 * @param {number} max
 */
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// The panes of this computer that run Claude, by account. A pane of another machine is left out: its
// processes cannot be resolved here, so its account is unknown. Each item carries what a click needs.
/**
 * @param {object} state
 * @param {Terminal[]} state.terminals
 * @param {Pane[]} state.panes
 * @param {Space[]} state.spaces
 * @param {Record<string, string>} state.byPid
 * @param {{ pane?: string | null, terminal?: string | null } | null} state.focus
 * @returns {Record<string, PaneItem[]>}
 */
export function accountPanes({ terminals, panes, spaces, byPid, focus }) {
  const places = new Map();
  for (const space of spaces) for (const tab of space.tabs ?? []) places.set(tab.id, { space, tab });
  /** @type {Record<string, PaneItem[]>} */
  const byAccount = {};
  const seen = new Set();
  for (const t of terminals) {
    const pid = localAddress(t.address) ? claudePid(t) : null;
    const name = pid === null ? null : byPid[String(pid)];
    if (!name || seen.has(pid)) continue;
    const pane = panes.find((p) => p.terminal === t.address);
    const place = pane ? places.get(pane.tab) : null;
    if (!pane || !place || place.space.machine) continue;
    seen.add(pid);
    const folder = base(pane.cwd);
    (byAccount[name] ??= []).push({
      terminal: t.address,
      pane: pane.pane,
      tab: place.tab.id,
      space: place.space.id,
      where: `${place.space.name} › ${place.tab.name}`,
      detail: folder || String(pane.title ?? ""),
      status: pane.status ?? null,
      focused: Boolean(focus && (focus.pane === pane.pane || focus.terminal === t.address)),
    });
  }
  return byAccount;
}

/** @param {PaneItem[]} items */
export const paneTooltip = (items) =>
  items.map((i) => clip(`${i.where}${i.detail ? ` · ${i.detail}` : ""}`, 48)).join("\n");

// What a click on a pane item runs, in order: the space, its tab, then the pane itself.
/**
 * @param {PaneItem} item
 * @returns {[string, Record<string, string>][]}
 */
export const goToCommands = (item) => [
  ["space.select", { id: item.space }],
  ["tab.select", { id: item.tab }],
  ["pane.focus", item.pane ? { pane: item.pane } : { terminal: item.terminal }],
];

// Demo mode, for screenshots: the CLI lists sample accounts and the mod draws sample panes, so nothing of the
// real machine (spaces, folders, e-mails) reaches the screen. "work" is the account with the panes.
/** @type {{ id: string, where: string, detail: string, status: PaneStatus, focused: boolean }[]} */
const DEMO_PANES = [
  { id: "api", where: "api-server › claude", detail: "src", status: "working", focused: true },
  { id: "web", where: "web-app › claude", detail: "checkout", status: "blocked", focused: false },
];

/**
 * @param {Account[]} accounts
 * @returns {View}
 */
export function demoView(accounts) {
  const items = DEMO_PANES.map(({ id, ...pane }) => ({
    terminal: `demo/${id}`,
    pane: `demo-pane-${id}`,
    tab: `demo-tab-${id}`,
    space: `demo-space-${id}`,
    ...pane,
  }));
  return {
    accounts,
    counts: { work: items.length },
    current: "work",
    session: { id: "00000000-0000-4000-8000-000000000000", cwd: "/home/demo/api-server" },
    error: null,
    panesOf: { work: items },
    focus: { pid: 0, cwd: "/home/demo/api-server" },
  };
}
