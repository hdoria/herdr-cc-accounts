#!/usr/bin/env node
// Adds the cc-accounts toggle button and side panel to a Herdr layout, or takes them out again.
// usage: place-layout.mjs <apply|remove> [--app <dir>] [--file <layout.json>] [--dry-run]
// The layout is --file, else the one Herdr reports as shown (the "layout" key of <app>/shared.json).
// Exit 1: nothing was written and the reason is on stderr. --dry-run prints the resulting JSON instead of writing.

import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOGGLE_ID = "cc-accounts-toggle";
const PANEL_ID = "cc-accounts-panel";
const BODY_ID = "cc-accounts";

const SHIPPED_LAYOUTS = ["main", "terminals", "win98"];

// Room for the 16 px avatar and about twelve characters of an account name; "Accounts" fits, longer names
// end in an ellipsis. The 10 px right padding of the block is part of the width.
const TOGGLE_WIDTH = 140;
/**
 * @param {number} [px]
 * @returns {LayoutNode}
 */
const TOGGLE_NODE = (px = TOGGLE_WIDTH) => ({
  id: TOGGLE_ID,
  type: "block",
  content: { mod: "cc-accounts", props: { role: "toggle" } },
  size: { px },
});
// Widths this script wrote before; such a node is ours and is resized instead of being a conflict.
const LEGACY_TOGGLE_WIDTHS = [150];

/** @returns {LayoutNode} */
const PANEL_NODE = () => ({
  id: PANEL_ID,
  type: "column",
  hidden: true,
  size: { px: 360 },
  min: 300,
  max: 600,
  children: [{ id: BODY_ID, type: "block", content: { mod: "cc-accounts", props: { role: "panel" } } }],
});

/**
 * @typedef {object} LayoutNode
 * @property {string} [id]
 * @property {string} [type]
 * @property {boolean} [hidden]
 * @property {LayoutNode[]} [children]
 * @property {{ mod?: string, tab?: string, props?: Record<string, unknown> }} [content]
 * @property {{ px: number }} [size]
 * @property {number} [min]
 * @property {number} [max]
 */

/** @typedef {LayoutNode & { children: LayoutNode[] }} Row */

/** @param {unknown} e */
function reason(e) {
  const code = e instanceof Error && "code" in e ? e.code : undefined;
  return code ?? (e instanceof Error ? e.message : String(e));
}

class Abort extends Error {}
class Usage extends Abort {}

/**
 * @param {LayoutNode} node
 * @param {(node: LayoutNode, parent: LayoutNode | null) => void} visit
 * @param {LayoutNode | null} [parent]
 */
function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const child of node.children ?? []) walk(child, visit, node);
}

/**
 * @param {LayoutNode} root
 * @param {string | undefined} id
 * @returns {{ node: LayoutNode, parent: LayoutNode | null } | null}
 */
const findNode = (root, id) => {
  /** @type {{ node: LayoutNode, parent: LayoutNode | null } | null} */
  let found = null;
  walk(root, (node, parent) => {
    if (node?.id === id && !found) found = { node, parent };
  });
  return found;
};

/**
 * @param {LayoutNode} root
 * @param {(child: LayoutNode) => boolean} matches
 * @returns {Row[]}
 */
function rowsWhere(root, matches) {
  /** @type {Row[]} */
  const rows = [];
  walk(root, (node) => {
    if (node.type === "row" && (node.children ?? []).some(matches)) rows.push(/** @type {Row} */ (node));
  });
  return rows;
}

/**
 * @param {LayoutNode} root
 * @param {(child: LayoutNode) => boolean} matches
 * @param {string} what
 * @param {string} hint
 */
function targetRow(root, matches, what, hint) {
  const rows = rowsWhere(root, matches);
  if (rows.length === 1) return rows[0];
  const why = rows.length === 0 ? `no row of the layout holds ${what}` : `${rows.length} rows hold ${what}`;
  throw new Abort(`${why}. ${hint}`);
}

const SHIPPED_HINT =
  "Herdr's own layouts (main, terminals, win98) are replaced on every start; clone the layout first " +
  "(herdr-app do layout.clone) or paste the JSON from the README by hand.";

// What each spec must look like if it is already in the layout, so a node with our id but other content is a conflict.
/**
 * @param {LayoutNode} root
 * @param {LayoutNode} spec
 * @param {string[]} ownIds
 * @param {LayoutNode[]} [legacy]
 * @returns {"present" | "legacy" | "conflict" | "absent"}
 */
function classify(root, spec, ownIds, legacy = []) {
  const hit = findNode(root, spec.id);
  if (hit) {
    if (isDeepStrictEqual(hit.node, spec)) return "present";
    return legacy.some((old) => isDeepStrictEqual(hit.node, old)) ? "legacy" : "conflict";
  }
  for (const id of ownIds) if (id !== spec.id && findNode(root, id)) return "conflict";
  return "absent";
}

/**
 * @param {LayoutNode} root
 * @returns {string[]}
 */
function apply(root) {
  const toggle = TOGGLE_NODE();
  const panel = PANEL_NODE();
  const legacyToggles = LEGACY_TOGGLE_WIDTHS.map((px) => TOGGLE_NODE(px));
  const states = {
    toggle: classify(root, toggle, [TOGGLE_ID], legacyToggles),
    panel: classify(root, panel, [PANEL_ID, BODY_ID]),
  };
  for (const [name, state] of Object.entries(states)) {
    if (state === "conflict")
      throw new Abort(
        `the layout already has a node with the id of the ${name} but different content; nothing was changed.`,
      );
  }
  /** @type {string[]} */
  const notes = [];
  /** @type {(() => void)[]} */
  const edits = [];
  const legacyHit = findNode(root, TOGGLE_ID);
  if (states.toggle === "legacy" && legacyHit) {
    edits.push(() => Object.assign(legacyHit.node, toggle));
    notes.push(`toggle resized to ${TOGGLE_WIDTH} px`);
  }
  if (states.toggle === "absent") {
    const row = targetRow(root, (c) => c?.content?.mod === "tabs", 'the "tabs" block', SHIPPED_HINT);
    edits.push(() => {
      // Before the last toggle button of another mod, so the buttons keep the order they already had; at the
      // end of the row when there is none.
      const at = row.children.findLastIndex((c) => c.content?.props?.role === "toggle");
      row.children.splice(at === -1 ? row.children.length : at, 0, toggle);
    });
    notes.push("toggle added to the tab bar row");
  }
  if (states.panel === "absent") {
    const row = targetRow(
      root,
      (c) => c?.content?.tab === "active",
      'the active tab\'s block ("content": {"tab": "active"})',
      SHIPPED_HINT,
    );
    edits.push(() => row.children.splice(row.children.findIndex((c) => c?.content?.tab === "active") + 1, 0, panel));
    notes.push("panel added after the active tab block");
  }
  for (const edit of edits) edit();
  return notes.length ? notes : ["already in place"];
}

/**
 * @param {LayoutNode} root
 * @returns {string[]}
 */
function remove(root) {
  /** @type {string[]} */
  const notes = [];
  /** @type {{ node: LayoutNode, siblings: LayoutNode[] }[]} */
  const taking = [];
  /** @type {[string, LayoutNode[]][]} */
  const ours = [
    [TOGGLE_ID, [TOGGLE_NODE(), ...LEGACY_TOGGLE_WIDTHS.map((px) => TOGGLE_NODE(px))]],
    [PANEL_ID, [PANEL_NODE()]],
  ];
  for (const [id, specs] of ours) {
    const hit = findNode(root, id);
    if (!hit) continue;
    if (!specs.some((spec) => isDeepStrictEqual(hit.node, spec)))
      throw new Abort(
        `the node "${id}" is not the one this script inserts (it was edited); remove it by hand. Nothing was changed.`,
      );
    const siblings = hit.parent?.children;
    if (!siblings)
      throw new Abort(`the node "${id}" is the root of the layout; remove it by hand. Nothing was changed.`);
    taking.push({ node: hit.node, siblings });
    notes.push(`${id} removed`);
  }
  for (const { node, siblings } of taking) siblings.splice(siblings.indexOf(node), 1);
  return notes.length ? notes : ["nothing to remove"];
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  /** @type {{ command: string, app: string, file: string | null, dryRun: boolean }} */
  const opts = {
    command,
    app: process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app"),
    file: null,
    dryRun: false,
  };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--dry-run") opts.dryRun = true;
    else if (rest[i] === "--app" && rest[i + 1]) opts.app = rest[++i];
    else if (rest[i] === "--file" && rest[i + 1]) opts.file = rest[++i];
    else throw new Usage(`unknown argument "${rest[i]}"`);
  }
  if (!["apply", "remove"].includes(command))
    throw new Usage("usage: place-layout.mjs <apply|remove> [--app <dir>] [--file <layout.json>] [--dry-run]");
  return opts;
}

/** @param {string} app */
function activeLayout(app) {
  try {
    const name = JSON.parse(readFileSync(join(app, "shared.json"), "utf8")).layout;
    if (typeof name === "string" && /^[\w.-]+$/.test(name)) return join(app, "layouts", `${name}.json`);
  } catch {
    // no readable shared.json: the caller is told to pass --file
  }
  throw new Abort(
    `could not tell which layout is shown (no "layout" in ${join(app, "shared.json")}); pass it with --file <layout.json>`,
  );
}

// ino:size:mtime of the file, so a write by someone else between our read and our rename is noticed.
/** @param {string} path */
export function fingerprint(path) {
  const stat = lstatSync(path);
  return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

// Milliseconds plus random bytes, so two runs in the same instant never pick the same name.
/** @param {string} target */
export const backupPath = (target) => `${target}.bak-${Date.now()}-${randomBytes(3).toString("hex")}`;

// Backs up, then writes through a temporary file and a rename. Aborts, leaving the target as it is, when the
// file changed since `seen` was taken or when the backup name is already taken (COPYFILE_EXCL).
/**
 * @param {string} target
 * @param {string} text
 * @param {string} seen
 * @param {{ beforeRename?: () => void, backupAs?: string }} [options]
 */
export function writeLayout(target, text, seen, { beforeRename, backupAs } = {}) {
  const backup = backupAs ?? backupPath(target);
  try {
    copyFileSync(target, backup, constants.COPYFILE_EXCL);
  } catch (e) {
    throw new Abort(`could not back up ${target} to ${backup}: ${reason(e)}`);
  }
  const mode = statSync(target).mode & 0o7777;
  const temp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, text, { flag: "wx", mode });
    chmodSync(temp, mode);
    beforeRename?.();
    if (fingerprint(target) !== seen) {
      throw new Abort(`${target} changed while it was being edited; nothing was written, run the command again`);
    }
    renameSync(temp, target);
  } catch (e) {
    rmSync(temp, { force: true });
    if (e instanceof Abort) throw e;
    throw new Abort(`could not write ${target}: ${reason(e)}`);
  }
  return backup;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const file = opts.file ?? activeLayout(opts.app);
  if (SHIPPED_LAYOUTS.includes(basename(file).replace(/\.json$/, "")))
    throw new Abort(`"${basename(file)}" is a Herdr layout. ${SHIPPED_HINT}`);
  /** @type {string} */
  let target;
  /** @type {LayoutNode} */
  let root;
  /** @type {string} */
  let seen;
  try {
    target = realpathSync(file);
    seen = fingerprint(target);
    root = JSON.parse(readFileSync(target, "utf8"));
  } catch (e) {
    throw new Abort(`could not read ${file} as JSON (${reason(e)})`);
  }
  if (typeof root !== "object" || root === null || Array.isArray(root))
    throw new Abort(`${file} is not a layout object`);

  const before = JSON.stringify(root);
  const notes = (opts.command === "apply" ? apply : remove)(root);
  const changed = JSON.stringify(root) !== before;
  const text = `${JSON.stringify(root, null, 2)}\n`;

  if (opts.dryRun) {
    process.stdout.write(text);
    process.stderr.write(`${notes.join("; ")} (dry run, ${target} untouched)\n`);
    return;
  }
  if (!changed) {
    process.stdout.write(`${notes.join("; ")} (${target})\n`);
    return;
  }

  const backup = writeLayout(target, text, seen);
  process.stdout.write(`${notes.join("; ")} (${target}, backup at ${backup})\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    process.stderr.write(`place-layout: ${e.message}\n`);
    process.exit(e instanceof Usage ? 2 : 1);
  }
}
