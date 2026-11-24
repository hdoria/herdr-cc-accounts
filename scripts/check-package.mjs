#!/usr/bin/env node
// The build of this repository. Herdr loads the mod's JavaScript as it is, so there is nothing to compile; what
// can go wrong is the folder the gallery copies (mods/cc-accounts/) not working on its own. This checks that it
// does: the files an install needs are there, the CLI is executable, no module reaches outside the folder, no icon
// is orphaned, and the repository root has the RECIPE.md (with the sections the gallery asks for, in order) and the
// preview.png the gallery lists the mod with.
// usage: check-package.mjs [<repo root>]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MOD_NAME = "cc-accounts";
const REQUIRED = ["main.js", "model.js", "cli.js", "cc-accounts", "mod.json"];
const GALLERY = ["RECIPE.md", "preview.png"];
const RECIPE_SECTIONS = ["What you see", "How it behaves", "Built from", "Watch out", "Done when"];
const MODULES = ["main.js", "model.js", "cli.js"];

/** @param {string} path */
function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Everything wrong with the mod folder, one sentence each. An empty list means the folder can be copied as is.
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function problems(root) {
  const mod = join(root, "mods", MOD_NAME);
  /** @type {string[]} */
  const found = [];

  for (const file of REQUIRED) {
    if (read(join(mod, file)) === null) found.push(`mods/${MOD_NAME}/${file} is missing`);
  }

  try {
    if ((statSync(join(mod, "cc-accounts")).mode & 0o111) === 0) found.push("the CLI is not executable");
  } catch {
    // a missing CLI is already reported above
  }
  if (!(read(join(mod, "cc-accounts")) ?? "#!/usr/bin/env node").startsWith("#!/usr/bin/env node\n")) {
    found.push("the CLI does not start with the node shebang");
  }

  for (const file of MODULES) {
    for (const [, specifier] of (read(join(mod, file)) ?? "").matchAll(/from "(\.[^"]*)"/g)) {
      if (specifier.startsWith("../") || read(join(mod, specifier)) === null) {
        found.push(`${file} imports ${specifier}, which is not a file of the folder`);
      }
    }
  }

  const main = read(join(mod, "main.js")) ?? "";
  /** @type {string[]} */
  let icons = [];
  try {
    icons = readdirSync(join(mod, "icons")).filter((name) => name.endsWith(".svg"));
  } catch {
    found.push(`mods/${MOD_NAME}/icons is missing`);
  }
  for (const icon of icons) {
    if (!main.includes(`"${icon.slice(0, -4)}"`)) found.push(`icons/${icon} is not used by main.js`);
  }
  if (!main.includes(`mods/${MOD_NAME}/icons/`))
    found.push(`main.js does not load its icons from mods/${MOD_NAME}/icons/`);

  const manifest = read(join(mod, "mod.json"));
  try {
    if (manifest !== null && typeof JSON.parse(manifest).title !== "string") found.push("mod.json has no title");
  } catch {
    found.push("mod.json is not valid JSON");
  }

  for (const file of GALLERY) {
    if (read(join(root, file)) === null) found.push(`${file} is missing`);
  }

  const recipe = read(join(root, "RECIPE.md")) ?? "";
  let from = 0;
  for (const section of RECIPE_SECTIONS) {
    const at = recipe.indexOf(`**${section}`, from);
    if (at === -1) found.push(`RECIPE.md has no "${section}" section, or has it out of order`);
    else from = at;
  }

  const keys = read(join(root, "keys.json"));
  if (keys === null || !keys.includes(`mod.open:${MOD_NAME}`))
    found.push(`keys.json does not bind mod.open:${MOD_NAME}`);

  return found;
}

function main() {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const found = problems(root);
  if (found.length === 0) {
    process.stdout.write(`ok: mods/${MOD_NAME} is self-contained and ready for the gallery\n`);
    return;
  }
  for (const line of found) process.stderr.write(`${line}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
