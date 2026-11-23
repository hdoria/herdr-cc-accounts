#!/usr/bin/env node
// Binds one key in a Herdr keys.json without disturbing the rest of the file.
// usage: bind-key.mjs <check|write> <keys.json> <key> <action>
// stdout: "present" (already bound to this action), "free" (check) or "written (backup at ...)".
// Exit 3: the key is taken by another action, in any section.

import {
  chmodSync,
  constants,
  copyFileSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";

const MODIFIERS = ["ctrl", "alt", "shift", "cmd"];

/** @param {unknown} e */
function reason(e) {
  const code = e instanceof Error && "code" in e ? e.code : undefined;
  return code ?? (e instanceof Error ? e.message : String(e));
}

// "shift-ctrl-a" and "ctrl-shift-a" are the same key.
/** @param {string} key */
function normalizeKey(key) {
  let rest = String(key).toLowerCase();
  const found = new Set();
  const next = () => MODIFIERS.find((m) => rest.startsWith(`${m}-`) && rest.length > m.length + 1);
  for (let m = next(); m; m = next()) {
    found.add(m);
    rest = rest.slice(m.length + 1);
  }
  return [...MODIFIERS.filter((m) => found.has(m)), rest].join("-");
}

/**
 * @param {string} message
 * @param {number} [code]
 * @returns {never}
 */
function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** @param {string[]} args */
function main([mode, file, key, action]) {
  if (!["check", "write"].includes(mode) || !file || !key || !action)
    fail("usage: bind-key.mjs <check|write> <keys.json> <key> <action>", 2);
  const target = realpathSync(file);
  let keys;
  try {
    keys = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    fail(`${file} is not valid JSON`);
  }
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) fail(`${file} is not a JSON object`);

  const wanted = normalizeKey(key);
  let present = false;
  for (const [section, map] of Object.entries(keys)) {
    if (typeof map !== "object" || map === null) continue;
    for (const [existing, bound] of Object.entries(map)) {
      if (normalizeKey(existing) !== wanted) continue;
      if (bound !== action)
        fail(`${key} is already taken in "${section}" (as ${existing}): ${JSON.stringify(bound)}`, 3);
      if (section === "global") present = true;
    }
  }
  if (present) {
    process.stdout.write("present\n");
    return;
  }
  if (mode === "check") {
    process.stdout.write("free\n");
    return;
  }

  // Milliseconds plus random bytes, so two runs in the same instant never pick the same name; COPYFILE_EXCL
  // makes a name that is taken an error instead of an overwrite.
  const backup = `${target}.bak-${Date.now()}-${randomBytes(3).toString("hex")}`;
  try {
    copyFileSync(target, backup, constants.COPYFILE_EXCL);
  } catch (e) {
    fail(`could not back up ${target} to ${backup}: ${reason(e)}`);
  }
  keys.global = { ...keys.global, [key]: action };
  const fileMode = statSync(target).mode & 0o7777;
  const temp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(keys, null, 2)}\n`, { flag: "wx", mode: fileMode });
    chmodSync(temp, fileMode);
    renameSync(temp, target);
  } catch (e) {
    rmSync(temp, { force: true });
    fail(`could not write ${target}: ${reason(e)}`);
  }
  process.stdout.write(`written (backup at ${backup})\n`);
}

main(process.argv.slice(2));
