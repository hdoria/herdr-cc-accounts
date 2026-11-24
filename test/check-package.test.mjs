import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { problems } from "../scripts/check-package.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

let root;
let n = 0;

// A copy of what the check reads, so a test can break it.
function copy() {
  const dir = join(root, `repo${n++}`);
  cpSync(join(REPO, "mods", "cc-accounts"), join(dir, "mods", "cc-accounts"), { recursive: true });
  for (const file of ["keys.json", "RECIPE.md", "preview.png"]) cpSync(join(REPO, file), join(dir, file));
  return dir;
}

const edit = (file, change) => writeFileSync(file, change(readFileSync(file, "utf8")));

before(() => {
  root = mkdtempSync(join(tmpdir(), "cc-accounts-package-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("check-package", () => {
  test("the mod folder of this repository is ready for the gallery", () => {
    assert.deepEqual(problems(REPO), []);
  });

  test("a missing file is named", () => {
    const dir = copy();
    rmSync(join(dir, "mods", "cc-accounts", "cli.js"));
    rmSync(join(dir, "RECIPE.md"));
    rmSync(join(dir, "preview.png"));
    const found = problems(dir);
    assert.ok(found.includes("mods/cc-accounts/cli.js is missing"), found.join("\n"));
    assert.ok(found.includes("RECIPE.md is missing"), found.join("\n"));
    assert.ok(found.includes("preview.png is missing"), found.join("\n"));
  });

  test("a CLI that is not executable or has no shebang is refused", () => {
    const dir = copy();
    const cli = join(dir, "mods", "cc-accounts", "cc-accounts");
    chmodSync(cli, 0o644);
    edit(cli, (text) => text.replace("#!/usr/bin/env node", "#!/bin/sh"));
    const found = problems(dir);
    assert.ok(found.includes("the CLI is not executable"), found.join("\n"));
    assert.ok(found.includes("the CLI does not start with the node shebang"), found.join("\n"));
  });

  test("a module that reaches outside the folder, or into nothing, is refused", () => {
    const dir = copy();
    const model = join(dir, "mods", "cc-accounts", "model.js");
    writeFileSync(
      model,
      `import { x } from "../outside.js";\nimport { y } from "./nowhere.js";\n${readFileSync(model, "utf8")}`,
    );
    const found = problems(dir);
    assert.ok(found.includes("model.js imports ../outside.js, which is not a file of the folder"), found.join("\n"));
    assert.ok(found.includes("model.js imports ./nowhere.js, which is not a file of the folder"), found.join("\n"));
  });

  test("an icon nobody uses is refused", () => {
    const dir = copy();
    writeFileSync(join(dir, "mods", "cc-accounts", "icons", "orphan.svg"), "<svg/>");
    assert.deepEqual(problems(dir), ["icons/orphan.svg is not used by main.js"]);
  });

  test("a recipe with a section missing or out of order is refused", () => {
    const dir = copy();
    edit(join(dir, "RECIPE.md"), (text) =>
      text
        .replace("**Watch out:**", "**Careful:**")
        .replace("**How it behaves:**", "**How it behaves:** **Done when:**"),
    );
    const found = problems(dir);
    assert.ok(
      found.some((line) => line.includes('"Watch out"')),
      found.join("\n"),
    );
  });

  test("a keys.json that does not open the mod, or a broken mod.json, is refused", () => {
    const dir = copy();
    writeFileSync(join(dir, "keys.json"), "{}");
    writeFileSync(join(dir, "mods", "cc-accounts", "mod.json"), "{ not json");
    const found = problems(dir);
    assert.ok(found.includes("keys.json does not bind mod.open:cc-accounts"), found.join("\n"));
    assert.ok(found.includes("mod.json is not valid JSON"), found.join("\n"));
  });

  test("the command prints ok and exits 0 here, and lists the problems and exits 1 on a broken copy", () => {
    const script = join(REPO, "scripts", "check-package.mjs");
    const ok = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^ok: mods\/cc-accounts is self-contained/);
    const dir = copy();
    rmSync(join(dir, "mods", "cc-accounts", "mod.json"));
    const bad = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /mod\.json is missing/);
  });
});
