// cc-accounts: Claude Code accounts side by side. Each account is its own CLAUDE_CONFIG_DIR under
// ~/.claude-accounts/<name>/; the default account is plain ~/.claude. The filesystem is the registry.
// Never writes to ~/.claude or ~/.claude.json and never reads a credential: it only asks whether a login exists.
// The `cc-accounts` file beside this one is the entry point and only calls `main`.

/** @import { Stats } from "node:fs" */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, userInfo } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { ACCOUNT_NAME, DEFAULT_ACCOUNT as DEFAULT, nameProblem } from "./model.js";

// What each entry of ~/.claude becomes inside an account. The single source of truth.
const SHARING = Object.freeze({
  // The user's own configuration: linked to ~/.claude.
  link: [
    "agents",
    "commands",
    "skills",
    "plugins",
    "hooks",
    "output-styles",
    "CLAUDE.md",
    "settings.json",
    "keybindings.json",
  ],
  // Also linked, so `--resume` finds a conversation started in any account.
  history: ["projects", "todos", "plans", "file-history", "shell-snapshots", "history.jsonl"],
  // Account or runtime state: never linked.
  private: {
    names: [
      ".credentials.json",
      ".claude.json",
      "sessions",
      "session-env",
      "statsig",
      "telemetry",
      "logs",
      "debug",
      "ide",
      "cache",
      "backups",
      "chrome",
      "paste-cache",
      "state",
      "tasks",
      "teams",
      "mcp-needs-auth-cache.json",
      "active-time.json",
      "antproto.json",
      "api-dumps",
      "bridge-spawn",
      "ccr",
      "ccr-home-seed.json",
      "computer-use.lock",
      "downloads",
      "dump-prompts",
      "feedback",
      "feedback-bundles",
      "file-transfers",
      "gh-pr-status-cache.json",
      "hfi-auth.json",
      "image-cache",
      "jobs",
      "local",
      "local-settings",
      "loop.md",
      "mcp-discovery-cache",
      "mcp-skill-archives",
      "policy-limits.json",
      "project-settings",
      "remote",
      "remote-control",
      "remote-settings.json",
      "scratch",
      "seed-admin",
      "server-sessions.json",
      "server.lock",
      "shares",
      "startup-perf",
      "stats-cache.json",
      "storage-v2",
      "systemd",
      "traces",
      "uploads",
      "usage-data",
    ],
    prefixes: [".", "daemon", "agent-memory"],
  },
  // Copied from ~/.claude.json into <account>/.claude.json, merged.
  state: {
    top: ["mcpServers"],
    project: [
      "mcpServers",
      "allowedTools",
      "hasTrustDialogAccepted",
      "enabledMcpjsonServers",
      "disabledMcpjsonServers",
    ],
  },
  // Array keys inside `state` that merge as a union (source first) instead of being replaced.
  union: ["allowedTools", "enabledMcpjsonServers", "disabledMcpjsonServers"],
});

const UNKNOWN = "unknown";

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{ name: string, dir: string | null }} AccountRef */
/** @typedef {{ write(text: string): unknown }} Output */
/** @typedef {{ changes: string[], warnings: string[] }} SyncReport */

/**
 * @param {unknown} e
 * @param {string} code
 */
const hasCode = (e, code) => e instanceof Error && "code" in e && e.code === code;

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode]
   */
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function home() {
  const h = process.env.HOME;
  if (!h) throw new CliError("the HOME variable is not set");
  return h;
}
const sourceDir = () => join(home(), ".claude");
const sourceState = () => join(home(), ".claude.json");
const accountsRoot = () => join(home(), ".claude-accounts");
/** @param {string} path */
const short = (path) => (path.startsWith(home()) ? `~${path.slice(home().length)}` : path);

/**
 * @param {unknown} v
 * @returns {v is JsonObject}
 */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @param {string} path
 * @returns {Stats | null}
 */
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (e) {
    if (hasCode(e, "ENOENT")) return null;
    throw e;
  }
}

/** @param {string} path */
function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** @param {string} name */
function classify(name) {
  if (SHARING.link.includes(name)) return "link";
  if (SHARING.history.includes(name)) return "history";
  const { names, prefixes } = SHARING.private;
  if (names.includes(name) || prefixes.some((p) => name.startsWith(p))) return "private";
  return null;
}

// A symlinked or ~/.claude-overlapping root would make links and writes land in the wrong place.
// A root that does not exist yet is judged by where it would land: the real parent plus its name.
function assertSafeRoot() {
  const root = accountsRoot();
  const stat = lstatOrNull(root);
  /**
   * @param {string} child
   * @param {string} parent
   */
  const inside = (child, parent) => child === parent || child.startsWith(parent + sep);
  if (!stat) {
    const source = realpathOrNull(sourceDir());
    const parent = realpathOrNull(dirname(root));
    if (source && parent && inside(join(parent, basename(root)), source)) {
      throw new CliError(`${short(root)} would be created inside ~/.claude; refusing to continue`);
    }
    return;
  }
  if (stat.isSymbolicLink()) throw new CliError(`${short(root)} is a symbolic link; refusing to continue`);
  if (!stat.isDirectory()) throw new CliError(`${short(root)} is not a directory; refusing to continue`);
  const source = realpathOrNull(sourceDir());
  if (!source) return;
  const real = realpathSync(root);
  if (inside(real, source) || inside(source, real)) {
    throw new CliError(`${short(root)} and ~/.claude overlap on disk; refusing to continue`);
  }
}

// The display name of the implicit account (~/.claude). A missing, invalid or colliding file means "default".
function defaultName() {
  let text;
  try {
    text = readFileSync(join(accountsRoot(), ".default-name"), "utf8");
  } catch {
    return DEFAULT;
  }
  const name = text.replace(/\r?\n$/, "");
  if (!ACCOUNT_NAME.test(name) || lstatOrNull(join(accountsRoot(), name))) return DEFAULT;
  return name;
}

/** @param {string | undefined} name */
function validateName(name) {
  const problem = nameProblem(name ?? "", { reserved: [DEFAULT, defaultName()] });
  if (problem) throw new CliError(problem, 2);
}

/** @returns {AccountRef[]} */
function listAccounts() {
  const shown = defaultName();
  /** @type {import("node:fs").Dirent[]} */
  let entries = [];
  try {
    entries = readdirSync(accountsRoot(), { withFileTypes: true });
  } catch (e) {
    if (!hasCode(e, "ENOENT")) throw e;
  }
  const names = entries
    .filter((e) => e.isDirectory() && ACCOUNT_NAME.test(e.name) && e.name !== DEFAULT && e.name !== shown)
    .map((e) => e.name)
    .sort();
  return [{ name: shown, dir: null }, ...names.map((name) => ({ name, dir: join(accountsRoot(), name) }))];
}

// Whether the account has a login, without reading it. On macOS Claude Code keeps the login in a generic
// Keychain item: the default account's is "Claude Code-credentials", the others' carry the first 8 hex digits of
// the sha256 of the config folder path (NFC) and the item's account is the user name. If
// CLAUDE_SECURESTORAGE_CONFIG_DIR is set it takes the place of the folder in that hash, for every account.
// The user name falls back to "claude-code-user" when it is not made of [a-zA-Z0-9._-], as Claude does.
// Only the exit code of `security find-generic-password` is used, never -w or -g, so the secret is not even
// requested. The login file <folder>/.credentials.json counts on macOS too, and is the only check elsewhere.
const KEYCHAIN_USER = /^[a-zA-Z0-9._-]+$/;
const FALLBACK_USER = "claude-code-user";

/**
 * @param {string | null | undefined} dir
 * @param {NodeJS.ProcessEnv} [env]
 */
export function keychainService(dir, env = process.env) {
  const folder = env.CLAUDE_SECURESTORAGE_CONFIG_DIR || dir;
  if (!folder) return "Claude Code-credentials";
  return `Claude Code-credentials-${createHash("sha256").update(folder.normalize("NFC")).digest("hex").slice(0, 8)}`;
}

/** @param {NodeJS.ProcessEnv} [env] */
export function keychainUser(env = process.env) {
  const user = env.USER || userInfo().username;
  return KEYCHAIN_USER.test(user) ? user : FALLBACK_USER;
}

/** @param {{ dir: string | null }} account */
function isSignedIn({ dir }) {
  if (lstatOrNull(join(dir ?? sourceDir(), ".credentials.json")) !== null) return true;
  if (process.platform !== "darwin") return false;
  return (
    spawnSync("security", ["find-generic-password", "-s", keychainService(dir), "-a", keychainUser()], {
      stdio: "ignore",
    }).status === 0
  );
}

/** @param {string} name */
function resolveAccount(name) {
  const accounts = listAccounts();
  if (name === DEFAULT) return accounts[0];
  const account = accounts.find((a) => a.name === name);
  if (!account) throw new CliError(`account "${name}" does not exist; create it with: cc-accounts add ${name}`);
  return account;
}

/**
 * @param {string} path
 * @param {string} label
 * @returns {JsonObject | null}
 */
function readJsonObject(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (hasCode(e, "ENOENT")) return null;
    const code = e instanceof Error && "code" in e ? e.code : undefined;
    throw new CliError(`could not read ${label}: ${code ?? messageOf(e)}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`${label} is not valid JSON; nothing was written`);
  }
  if (!isObject(value)) throw new CliError(`${label} is not a JSON object; nothing was written`);
  return value;
}

/**
 * @param {string} statePath
 * @returns {string | null}
 */
function emailOf(statePath) {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"))?.oauthAccount?.emailAddress ?? null;
  } catch {
    return null;
  }
}

// ---- state copied from ~/.claude.json ----

/**
 * @param {JsonObject} source
 * @param {string[]} keys
 */
function pick(source, keys) {
  /** @type {JsonObject} */
  const out = {};
  for (const key of keys) if (Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}

/** @param {JsonObject} source */
function sharedState(source) {
  const out = pick(source, SHARING.state.top);
  if (isObject(source.projects)) {
    /** @type {Record<string, JsonObject>} */
    const projects = {};
    for (const [path, entry] of Object.entries(source.projects)) {
      if (!isObject(entry)) continue;
      const slice = pick(entry, SHARING.state.project);
      if (Object.keys(slice).length > 0) projects[path] = slice;
    }
    if (Object.keys(projects).length > 0) out.projects = projects;
  }
  return out;
}

// The source wins per key; what exists only in the account stays. Trust already granted is never lost.
// mcpServers is a union, so a server removed from the default account does not disappear from the others.
// allowedTools and the two server lists are unions too, source first, so nothing the account granted is lost.
/**
 * @param {string} key
 * @param {unknown} current
 * @param {unknown} next
 */
function mergeKey(key, current, next) {
  if (key === "mcpServers" && isObject(current) && isObject(next)) return { ...current, ...next };
  if (SHARING.union.includes(key) && Array.isArray(current) && Array.isArray(next)) return unionOf(next, current);
  if (key === "hasTrustDialogAccepted" && current === true) return true;
  return next;
}

/**
 * @param {unknown[]} first
 * @param {unknown[]} second
 */
function unionOf(first, second) {
  const seen = new Set();
  return [...first, ...second].filter((item) => {
    const id = JSON.stringify(item);
    return seen.has(id) ? false : seen.add(id);
  });
}

/**
 * @param {JsonObject} current
 * @param {JsonObject} shared
 */
function mergeState(current, shared) {
  const out = { ...current };
  for (const [key, value] of Object.entries(shared)) {
    if (key !== "projects") {
      out[key] = mergeKey(key, current[key], value);
    } else if (current.projects === undefined || isObject(current.projects)) {
      /** @type {Record<string, unknown>} */
      const projects = { ...current.projects };
      for (const [path, slice] of Object.entries(/** @type {Record<string, JsonObject>} */ (value))) {
        const own = /** @type {JsonObject} */ (isObject(projects[path]) ? projects[path] : {});
        const merged = { ...own };
        for (const [k, v] of Object.entries(slice)) merged[k] = mergeKey(k, own[k], v);
        projects[path] = merged;
      }
      out.projects = projects;
    }
  }
  return out;
}

/**
 * @param {string} target
 * @param {string} content
 */
function writeAtomic(target, content) {
  const temp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
    renameSync(temp, target);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}

/** @param {string} path */
function fingerprint(path) {
  const stat = lstatOrNull(path);
  return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : "absent";
}

/**
 * @param {string} dir
 * @returns {{ warning?: string, content?: undefined } | { target: string, seen: string, content: string, warning?: undefined }}
 */
function planState(dir) {
  const source = readJsonObject(sourceState(), "~/.claude.json");
  if (!source) return { warning: "~/.claude.json does not exist: state not replicated" };
  const target = join(dir, ".claude.json");
  const seen = fingerprint(target);
  const current = readJsonObject(target, short(target));
  const next = mergeState(current ?? {}, sharedState(source));
  const same = current ? JSON.stringify(next) === JSON.stringify(current) : Object.keys(next).length === 0;
  return same ? {} : { target, seen, content: `${JSON.stringify(next, null, 2)}\n` };
}

// Merges, then re-checks that the account file did not change meanwhile. If it did, merges once more
// instead of overwriting what the other writer just saved. An invalid JSON aborts before any write.
/**
 * @param {string} dir
 * @param {{ beforeCommit?: () => void }} [options]
 * @returns {{ changed: boolean, warning?: string }}
 */
export function syncState(dir, { beforeCommit } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = planState(dir);
    if (!plan.content) return { changed: false, warning: plan.warning };
    beforeCommit?.();
    if (fingerprint(plan.target) === plan.seen) {
      writeAtomic(plan.target, plan.content);
      return { changed: true };
    }
  }
  throw new CliError(`${short(join(dir, ".claude.json"))} kept changing while syncing; run sync again`);
}

// ---- links ----

// Unique by construction (time, pid and 48 random bits), so two processes never pick the same name.
// A rename silently replaces a file at its destination, which is why the name must never repeat;
// the lstat only guards the astronomically unlikely clash and a leftover from an earlier run.
/** @param {string} path */
function divergentName(path) {
  for (;;) {
    const candidate = `${path}.divergent-${Math.floor(Date.now() / 1000)}-${process.pid}-${randomBytes(3).toString("hex")}`;
    if (!lstatOrNull(candidate)) return candidate;
  }
}

/** @param {Stats} stat */
function describeIntruder(stat) {
  if (stat.isSymbolicLink()) return "was a link to another target";
  return stat.isDirectory() ? "was a regular folder" : "was a regular file";
}

/**
 * @param {Stats} a
 * @param {Stats} b
 */
const sameEntry = (a, b) => a.ino === b.ino && a.dev === b.dev;

// Concurrent syncs can create or move the same entry between our check and our write, so every
// failure of that kind re-reads the target instead of trusting the earlier look. Content that is
// moved aside is never overwritten (unique name) and never lost to a stale look: the entry is
// re-checked by inode right before the rename and by content right after it.
/**
 * @param {string} source
 * @param {string} target
 * @param {string} name
 * @returns {string | null}
 */
function ensureLink(source, target, name) {
  /** @type {string | null} */
  let note = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const stat = lstatOrNull(target);
    if (stat?.isSymbolicLink() && readlinkSync(target) === source) return note;
    if (stat) {
      const now = lstatOrNull(target);
      if (!now || !sameEntry(now, stat)) continue;
      const kept = divergentName(target);
      try {
        renameSync(target, kept);
      } catch (e) {
        if (hasCode(e, "ENOENT")) continue;
        throw e;
      }
      const moved = lstatOrNull(kept);
      if (moved?.isSymbolicLink() && readlinkSync(kept) === source) {
        rmSync(kept, { force: true });
      } else {
        note = `repaired: ${name} ${describeIntruder(moved ?? stat)}; kept as ${basename(kept)} and link recreated`;
      }
    }
    try {
      symlinkSync(source, target);
      return note ?? `link created: ${name}`;
    } catch (e) {
      if (!hasCode(e, "EEXIST") && !hasCode(e, "ENOENT")) throw e;
    }
  }
  throw new CliError(`could not link ${name}: the account folder is changing concurrently; run sync again`);
}

/** @param {string} dir */
function applyLinks(dir) {
  const changes = [];
  for (const name of [...SHARING.link, ...SHARING.history]) {
    const source = join(sourceDir(), name);
    if (!lstatOrNull(source)) continue;
    const change = ensureLink(source, join(dir, name), name);
    if (change) changes.push(change);
  }
  return changes;
}

// The shared settings.json applies to every account, including these credential-shaped keys.
function sharedCredentialSettings() {
  let settings;
  try {
    settings = JSON.parse(readFileSync(join(sourceDir(), "settings.json"), "utf8"));
  } catch {
    return [];
  }
  if (!isObject(settings)) return [];
  const found = [];
  if (Object.hasOwn(settings, "apiKeyHelper")) found.push("apiKeyHelper");
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    if (isObject(settings.env) && Object.hasOwn(settings.env, key)) found.push(`env.${key}`);
  }
  return found;
}

// Observations about ~/.claude that hold for the whole run, not for one account.
function diagnoseSource() {
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  let entries = [];
  try {
    entries = readdirSync(sourceDir());
  } catch (e) {
    if (!hasCode(e, "ENOENT")) throw e;
    return ["~/.claude does not exist: nothing to share"];
  }
  const missing = [...SHARING.link, ...SHARING.history].filter((n) => !entries.includes(n));
  if (missing.length > 0) warnings.push(`skipped, missing in ~/.claude (not created): ${missing.join(", ")}`);
  const unclassified = entries.filter((n) => classify(n) === null).sort();
  if (unclassified.length > 0)
    warnings.push(`unclassified in ~/.claude, review the sharing table: ${unclassified.join(", ")}`);
  const credentials = sharedCredentialSettings();
  if (credentials.length > 0) {
    warnings.push(
      `shared settings.json sets ${credentials.join(", ")}; it applies to every account, not only the default one`,
    );
  }
  return warnings;
}

// A link in place of an account's own file would make a write land somewhere else, so it is refused.
/** @param {string} dir */
function assertNoLinkedPrivateFiles(dir) {
  for (const name of [".claude.json", ".credentials.json"]) {
    if (lstatOrNull(join(dir, name))?.isSymbolicLink()) {
      throw new CliError(`${short(join(dir, name))} is a symbolic link; refusing to write through it`);
    }
  }
}

// Reapplies the sharing table to one account. Idempotent: returns only what changed.
// With `lenient`, a state problem becomes a warning and the links are still applied.
/**
 * @param {AccountRef} account
 * @param {{ lenient?: boolean }} [options]
 * @returns {SyncReport}
 */
function syncAccount(account, { lenient = false } = {}) {
  if (account.dir === null) throw new CliError(`"${account.name}" is ~/.claude itself: there is nothing to sync`, 2);
  const changes = [];
  const warnings = [];
  try {
    assertNoLinkedPrivateFiles(account.dir);
    const result = syncState(account.dir);
    if (result.changed) changes.push("state: mcpServers and project trust copied into .claude.json");
    if (result.warning) warnings.push(result.warning);
  } catch (e) {
    if (!lenient || !(e instanceof CliError)) throw e;
    warnings.push(e.message);
  }
  changes.push(...applyLinks(account.dir));
  return { changes, warnings };
}

/**
 * @param {string} name
 * @param {SyncReport} syncReport
 * @param {Output} out
 */
function report(name, { changes, warnings }, out) {
  out.write(`${name}:\n`);
  for (const c of changes) out.write(`  ${c}\n`);
  for (const w of warnings) out.write(`  warning: ${w}\n`);
  if (changes.length === 0) out.write("  nothing to change\n");
}

// ---- commands ----

/** @param {string[]} args */
function cmdLs(args) {
  const json = args.includes("--json");
  if (args.some((a) => a !== "--json")) throw new CliError("usage: cc-accounts ls [--json]", 2);
  const demo = isDemo();
  // The default account keeps its state in ~/.claude.json, the others inside their own folder.
  const accounts = demo
    ? DEMO_ACCOUNTS
    : listAccounts().map(({ name, dir }) => ({
        name,
        dir,
        email: emailOf(dir ? join(dir, ".claude.json") : sourceState()),
        signedIn: isSignedIn({ dir }),
      }));
  if (json) {
    process.stdout.write(`${JSON.stringify({ demo, accounts }, null, 2)}\n`);
    return;
  }
  if (demo) process.stdout.write("demo mode: sample accounts, nothing is read from this machine\n");
  const width = Math.max(...accounts.map((a) => a.name.length));
  for (const a of accounts) {
    const email = a.email ?? "(not logged in)";
    const status = a.signedIn ? "signed in" : "not signed in";
    process.stdout.write(
      `${a.name.padEnd(width)}  ${email.padEnd(32)}  ${status.padEnd(13)}  ${a.dir ? short(a.dir) : "~/.claude (default)"}\n`,
    );
  }
}

// Demo mode is a flag file. While it exists `ls` lists fixed sample accounts, so a screenshot shows no real data.
const demoFlag = () => join(accountsRoot(), ".demo");
const isDemo = () => lstatOrNull(demoFlag()) !== null;

const DEMO_ACCOUNTS = Object.freeze([
  { name: "personal", dir: null, email: "personal@example.com", signedIn: true },
  { name: "client", dir: "~/.claude-accounts/client", email: "client@example.com", signedIn: false },
  { name: "work", dir: "~/.claude-accounts/work", email: "work@example.com", signedIn: true },
]);

/** @param {string[]} args */
function cmdDemo(args) {
  const [mode] = args;
  if (args.length !== 1 || (mode !== "on" && mode !== "off")) throw new CliError("usage: cc-accounts demo on|off", 2);
  if (mode === "off") {
    rmSync(demoFlag(), { force: true });
    process.stdout.write("demo mode off\n");
    return;
  }
  mkdirSync(accountsRoot(), { recursive: true, mode: 0o700 });
  assertSafeRoot();
  if (!isDemo()) writeFileSync(demoFlag(), "", { mode: 0o600 });
  process.stdout.write("demo mode on: ls lists sample accounts until you run: cc-accounts demo off\n");
}

/** @param {string[]} args */
function cmdAdd(args) {
  if (args.length !== 1) throw new CliError("usage: cc-accounts add <name>", 2);
  const [name] = args;
  validateName(name);
  const dir = join(accountsRoot(), name);
  const existed = Boolean(lstatOrNull(dir));
  mkdirSync(accountsRoot(), { recursive: true, mode: 0o700 });
  assertSafeRoot();
  mkdirSync(dir, { mode: 0o700, recursive: true });
  process.stdout.write(
    existed ? `account ${name} already existed at ${short(dir)}\n` : `account ${name} created at ${short(dir)}\n`,
  );
  report(name, syncAccount(resolveAccount(name)), process.stdout);
  for (const w of diagnoseSource()) process.stdout.write(`warning: ${w}\n`);
  if (!existed) process.stdout.write(`still to do: log in. Open a tab with "cc-accounts run ${name}" and use /login\n`);
}

/** @param {string[]} args */
function cmdSync(args) {
  if (args.length > 1) throw new CliError("usage: cc-accounts sync [<name>]", 2);
  const targets = args[0] ? [resolveAccount(args[0])] : listAccounts().slice(1);
  if (targets.length === 0) {
    process.stdout.write("no account besides the default one; create one with: cc-accounts add <name>\n");
    return;
  }
  for (const account of targets) report(account.name, syncAccount(account), process.stdout);
  for (const w of diagnoseSource()) process.stdout.write(`warning: ${w}\n`);
}

/** @param {string[]} args */
function cmdRun(args) {
  const [name, ...rest] = args;
  if (!name) throw new CliError("usage: cc-accounts run <name> [args...]", 2);
  const account = resolveAccount(name);
  const env = { ...process.env };
  if (account.dir === null) {
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    try {
      const { changes, warnings } = syncAccount(account, { lenient: true });
      for (const c of changes) process.stderr.write(`cc-accounts ${name}: ${c}\n`);
      for (const w of warnings) process.stderr.write(`cc-accounts ${name}: warning: ${w}\n`);
    } catch (e) {
      process.stderr.write(`cc-accounts ${name}: warning: sync failed (${messageOf(e)}); opening claude anyway\n`);
    }
    env.CLAUDE_CONFIG_DIR = account.dir;
  }
  // Node has no exec: the child inherits the terminal and this process only relays signals and the exit code.
  const child = spawn("claude", rest, { stdio: "inherit", env });
  /** @type {NodeJS.Signals[]} */
  const relayed = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
  for (const signal of relayed) process.on(signal, () => child.kill(signal));
  child.on("error", (e) => {
    process.stderr.write(
      hasCode(e, "ENOENT") ? "cc-accounts: the claude command is not on PATH\n" : `cc-accounts: ${e.message}\n`,
    );
    process.exit(hasCode(e, "ENOENT") ? 127 : 1);
  });
  child.on("exit", (code, signal) =>
    process.exit(code ?? 128 + (signal === null ? 0 : (osConstants.signals[signal] ?? 0))),
  );
}

/**
 * @param {string[]} args
 * @returns {string | null}
 */
function psLine(args) {
  const r = spawnSync("ps", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.replace(/\r?\n$/, "") : null;
}

function knownAccounts() {
  return listAccounts().map((a) => ({ ...a, real: a.dir ? realpathOrNull(a.dir) : realpathOrNull(sourceDir()) }));
}

// The process may be the `cc-accounts run <name>` wrapper, which sits in front of claude because Node
// cannot exec. It is recognized, never read: some stretch of the command line before " run " has to
// resolve on disk to this very script, so a path with spaces works and a name in the arguments proves nothing.
// Only a few places are tried (the first " run " markers, the first starts after an interpreter and its
// flags), so a long command line costs a fixed number of lookups, not one per pair of spaces.
const WRAPPER_MARKERS = 3;
const WRAPPER_STARTS = 4;

export const entryScript = () => realpathOrNull(process.argv[1] ?? "");

/**
 * @param {string} argvLine
 * @param {string | null} [self]
 */
export function isRunWrapper(argvLine, self = entryScript()) {
  if (!self) return false;
  let at = argvLine.indexOf(" run ");
  for (let marker = 0; at !== -1 && marker < WRAPPER_MARKERS; marker++, at = argvLine.indexOf(" run ", at + 1)) {
    const head = argvLine.slice(0, at);
    let space = head.indexOf(" ");
    for (let start = 0; space !== -1 && start < WRAPPER_STARTS; start++, space = head.indexOf(" ", space + 1)) {
      if (realpathOrNull(head.slice(space + 1)) === self) return true;
    }
  }
  return false;
}

// A wrapper of some other copy of the CLI: its environment names no account either, so `default` would be a
// guess. Only the end of the path is looked at, which also catches a copy in a folder with spaces.
const OTHER_WRAPPER = /(?:^|[\s/])cc-accounts run(?:\s|$)/;

// The wrapper's own environment says nothing: the account is set only in the environment of the claude it
// starts. So the answer comes from its children, and only when they all agree on a known account.
/**
 * @param {string} pid
 * @param {ReturnType<typeof knownAccounts>} known
 * @returns {string}
 */
function accountFromChildren(pid, known) {
  const r = spawnSync("pgrep", ["-P", pid], { encoding: "utf8" });
  const children = r.status === 0 ? r.stdout.split("\n").filter((l) => /^\d+$/.test(l)) : [];
  const answers = new Set(
    children.map((child) => {
      const line = psLine(["-ww", "-o", "command=", "-p", child]);
      return line === null ? UNKNOWN : accountFromEnvironment(child, line, known);
    }),
  );
  return answers.size === 1 && !answers.has(UNKNOWN) ? [...answers][0] : UNKNOWN;
}

// Separates argv from the environment by comparing `ps` with and without -E, and extracts only
// CLAUDE_CONFIG_DIR. The result is matched against known accounts; text from `ps` is never echoed.
// ps joins the variables with spaces, so a value can imitate a variable: a second CLAUDE_CONFIG_DIR= is
// unknown. A single one whose value is followed by what looks like another variable cannot be told from a
// value with spaces, and is read as the shorter one; the result is still only a known account name.
/**
 * @param {string} pid
 * @param {string} argvLine
 * @param {ReturnType<typeof knownAccounts>} known
 * @returns {string}
 */
function accountFromEnvironment(pid, argvLine, known) {
  const full = psLine(["-E", "-ww", "-o", "command=", "-p", pid]);
  if (full === null || !full.startsWith(argvLine)) return UNKNOWN;
  const environment = full.slice(argvLine.length);
  if (!/^\s+\S/.test(environment)) return UNKNOWN;
  if ((environment.match(/(?:^|\s)CLAUDE_CONFIG_DIR=/g) ?? []).length > 1) return UNKNOWN;
  const match = /(?:^|\s)CLAUDE_CONFIG_DIR=(.*?)(?=\s[^\s=]+=|$)/.exec(environment);
  if (!match || match[1] === "") return known[0].name;
  const real = realpathOrNull(match[1]);
  if (!real) return UNKNOWN;
  return known.find((a) => a.real === real)?.name ?? UNKNOWN;
}

// One line per pid, "<pid> <account|unknown>", so a caller with many panes asks once. A pid that is not
// running prints "unknown" and makes the exit code 1, after every line was printed.
/** @param {string[]} args */
function cmdWhich(args) {
  if (args.length === 0 || args.some((a) => !/^\d+$/.test(a)))
    throw new CliError("usage: cc-accounts which <pid> [<pid>...]", 2);
  const known = knownAccounts();
  const missing = [];
  for (const pid of args) {
    const argvLine = psLine(["-ww", "-o", "command=", "-p", pid]);
    if (argvLine === null || argvLine.trim() === "") {
      missing.push(pid);
      process.stdout.write(`${pid} ${UNKNOWN}\n`);
      continue;
    }
    const name = isRunWrapper(argvLine)
      ? accountFromChildren(pid, known)
      : OTHER_WRAPPER.test(argvLine)
        ? UNKNOWN
        : accountFromEnvironment(pid, argvLine, known);
    process.stdout.write(`${pid} ${name}\n`);
  }
  if (missing.length) throw new CliError(`process ${missing.join(", ")} not running`);
}

const USAGE = `cc-accounts: Claude Code accounts side by side

usage:
  cc-accounts ls [--json]        list accounts: email, login status and folder
  cc-accounts add <name>         create an account and apply the sharing table
  cc-accounts sync [<name>]      reapply links and state (idempotent)
  cc-accounts run <name> [args]  open claude in an account (default uses ~/.claude)
  cc-accounts which <pid>...     print "<pid> <account>" per claude process, "unknown" if not known
  cc-accounts demo on|off        list sample accounts instead of yours, for screenshots
`;

/** @type {Record<string, (args: string[]) => void>} */
const COMMANDS = { ls: cmdLs, add: cmdAdd, sync: cmdSync, run: cmdRun, which: cmdWhich, demo: cmdDemo };

/** @param {string[]} argv */
function execute(argv) {
  const [command, ...args] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  const fn = COMMANDS[command];
  if (!fn) throw new CliError(`unknown command "${command}"\n\n${USAGE}`, 2);
  assertSafeRoot();
  fn(args);
}

/** @param {string[]} argv */
export function main(argv) {
  try {
    execute(argv);
  } catch (e) {
    process.stderr.write(`cc-accounts: ${messageOf(e)}\n`);
    process.exitCode = e instanceof CliError ? e.exitCode : 1;
  }
}
