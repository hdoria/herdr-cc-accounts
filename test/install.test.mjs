import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "ctrl-shift-a";
const ACTION = "mod.open:cc-accounts";
const SAMPLE_KEYS = {
  global: { "cmd-t": "tab.new", "cmd-shift-p": "app.palette" },
  terminal: { "ctrl-shift-c": "terminal.copy" },
};

let root;
let n = 0;

function setup({ keys = SAMPLE_KEYS } = {}) {
  const home = join(root, `h${n++}`);
  const app = join(home, "app");
  mkdirSync(join(app, "mods"), { recursive: true });
  writeFileSync(join(app, "keys.json"), `${JSON.stringify(keys, null, 2)}\n`);
  return { home, app, keys: join(app, "keys.json") };
}

function install({ home, app }, args = []) {
  const r = spawnSync("bash", [join(REPO, "install.sh"), ...args], {
    env: { HOME: home, HERDR_APP_HOME: app, PATH: process.env.PATH },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const readKeys = (file) => JSON.parse(readFileSync(file, "utf8"));
const backups = (app) => readdirSync(app).filter((name) => name.startsWith("keys.json.bak-"));

before(() => {
  root = mkdtempSync(join(tmpdir(), "cc-accounts-install-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("install.sh", () => {
  test("installs the link, the mod and the key, and a second run changes nothing", () => {
    const env = setup();
    const first = install(env);
    assert.equal(first.code, 0, first.err);
    assert.equal(lstatSync(join(env.home, ".local", "bin", "cc-accounts")).isSymbolicLink(), true);
    assert.ok(existsSync(join(env.app, "mods", "cc-accounts", "main.js")));
    const mod = JSON.parse(readFileSync(join(env.app, "mods", "cc-accounts", "mod.json"), "utf8"));
    assert.equal(mod.title, "Claude Code accounts");
    assert.equal(readKeys(env.keys).global[KEY], ACTION);
    assert.equal(readKeys(env.keys).global["cmd-t"], "tab.new");
    assert.equal(backups(env.app).length, 1);

    const second = install(env);
    assert.equal(second.code, 0, second.err);
    assert.match(second.out, /key ctrl-shift-a: present/);
    assert.equal(backups(env.app).length, 1);
  });

  test("the link points to the CLI inside the installed mod folder, and the mod folder is all the CLI needs", () => {
    const env = setup();
    assert.equal(install(env).code, 0);
    const link = join(env.home, ".local", "bin", "cc-accounts");
    const cli = join(env.app, "mods", "cc-accounts", "cc-accounts");
    assert.equal(readlinkSync(link), cli);
    assert.ok(statSync(cli).mode & 0o111, "the installed CLI is executable");
    const run = spawnSync(link, ["demo", "on"], { env: { HOME: env.home, PATH: process.env.PATH }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const ls = spawnSync(link, ["ls", "--json"], { env: { HOME: env.home, PATH: process.env.PATH }, encoding: "utf8" });
    assert.equal(JSON.parse(ls.stdout).demo, true);
  });

  test("links to the old repo path or to ~/.local/share/cc-accounts are ours and are replaced", () => {
    for (const old of [
      join("x", "herdr-cc-accounts", "bin", "cc-accounts"),
      join(".local", "share", "cc-accounts", "cc-accounts"),
    ]) {
      const env = setup();
      const target = join(env.home, old);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "#!/bin/sh\n");
      mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
      symlinkSync(target, join(env.home, ".local", "bin", "cc-accounts"));
      const r = install(env);
      assert.equal(r.code, 0, r.err);
      assert.equal(
        readlinkSync(join(env.home, ".local", "bin", "cc-accounts")),
        join(env.app, "mods", "cc-accounts", "cc-accounts"),
      );
    }
  });

  test("the recipe, the preview and the generated files of Herdr are not copied", () => {
    const env = setup();
    assert.equal(install(env).code, 0);
    assert.deepEqual(readdirSync(join(env.app, "mods", "cc-accounts")).sort(), [
      "cc-accounts",
      "cli.js",
      "icons",
      "main.js",
      "mod.json",
      "model.js",
    ]);
  });

  test("the link an older layout of this repository made (bin/cc-accounts) is replaced", () => {
    const env = setup();
    mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
    symlinkSync(join(REPO, "bin", "cc-accounts"), join(env.home, ".local", "bin", "cc-accounts"));
    const r = install(env);
    assert.equal(r.code, 0, r.err);
    assert.equal(
      readlinkSync(join(env.home, ".local", "bin", "cc-accounts")),
      join(env.app, "mods", "cc-accounts", "cc-accounts"),
    );
  });

  test("the repo keys.json documents the same binding the installer writes", () => {
    const env = setup();
    install(env);
    const documented = readKeys(join(REPO, "keys.json")).global;
    for (const [key, action] of Object.entries(documented)) assert.equal(readKeys(env.keys).global[key], action);
  });

  test("a folder at the mod path that is not ours aborts everything", () => {
    const env = setup();
    const mod = join(env.app, "mods", "cc-accounts");
    mkdirSync(mod);
    writeFileSync(join(mod, "mod.json"), JSON.stringify({ title: "Somebody else's mod" }));
    writeFileSync(join(mod, "main.js"), "// theirs\n");
    const r = install(env);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /not this mod/);
    assert.equal(readFileSync(join(mod, "main.js"), "utf8"), "// theirs\n");
    assert.ok(!existsSync(join(env.home, ".local", "bin", "cc-accounts")));
    assert.deepEqual(readKeys(env.keys), SAMPLE_KEYS);
  });

  test("a folder without a mod.json, or a link at the mod path, also aborts", () => {
    const bare = setup();
    mkdirSync(join(bare.app, "mods", "cc-accounts"));
    assert.notEqual(install(bare).code, 0);

    const linked = setup();
    const elsewhere = join(root, `elsewhere${n}`);
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(linked.app, "mods", "cc-accounts"));
    assert.notEqual(install(linked).code, 0);
    assert.deepEqual(readdirSync(elsewhere), []);
  });

  test("a key held by another action under a different modifier order aborts without changes", () => {
    for (const taken of ["shift-ctrl-a", "CTRL-SHIFT-A"]) {
      const env = setup({ keys: { ...SAMPLE_KEYS, terminal: { [taken]: "terminal.something" } } });
      const r = install(env);
      assert.notEqual(r.code, 0, taken);
      assert.match(r.err, /already taken/);
      assert.deepEqual(readKeys(env.keys).terminal, { [taken]: "terminal.something" });
      assert.ok(!existsSync(join(env.home, ".local", "bin", "cc-accounts")));
      assert.deepEqual(backups(env.app), []);
    }
  });

  test("the same binding under another spelling counts as already present", () => {
    const env = setup({ keys: { global: { "shift-ctrl-a": ACTION } } });
    const r = install(env);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /key ctrl-shift-a: present/);
    assert.deepEqual(readKeys(env.keys), { global: { "shift-ctrl-a": ACTION } });
    assert.deepEqual(backups(env.app), []);
  });

  test("a different modifier set is a different key", () => {
    const env = setup({ keys: { global: { "ctrl-alt-a": "other.action" } } });
    assert.equal(install(env).code, 0);
    assert.equal(readKeys(env.keys).global["ctrl-alt-a"], "other.action");
    assert.equal(readKeys(env.keys).global[KEY], ACTION);
  });

  test("a keys.json that is a symbolic link is written through, and its mode is kept", () => {
    const env = setup();
    const real = join(root, `real-keys${n}.json`);
    writeFileSync(real, readFileSync(env.keys));
    chmodSync(real, 0o640);
    rmSync(env.keys);
    symlinkSync(real, env.keys);
    const r = install(env);
    assert.equal(r.code, 0, r.err);
    assert.equal(lstatSync(env.keys).isSymbolicLink(), true);
    assert.equal(readKeys(real).global[KEY], ACTION);
    assert.equal(statSync(real).mode & 0o777, 0o640);
    assert.ok(readdirSync(root).filter((name) => name.startsWith(`real-keys${n}.json.bak-`)).length === 1);
  });

  test("an invalid keys.json aborts without touching anything else", () => {
    const env = setup();
    writeFileSync(env.keys, "{ broken");
    const r = install(env);
    assert.notEqual(r.code, 0);
    assert.ok(!existsSync(join(env.home, ".local", "bin", "cc-accounts")));
    assert.equal(readFileSync(env.keys, "utf8"), "{ broken");
  });

  test("a file at the link path that is not a link aborts", () => {
    const env = setup();
    mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
    writeFileSync(join(env.home, ".local", "bin", "cc-accounts"), "mine\n");
    const r = install(env);
    assert.notEqual(r.code, 0);
    assert.equal(readFileSync(join(env.home, ".local", "bin", "cc-accounts"), "utf8"), "mine\n");
  });

  test(
    "a keys.json that cannot be backed up aborts with an error, not with 'done'",
    { skip: process.getuid?.() === 0 },
    () => {
      const env = setup();
      const before = readFileSync(env.keys, "utf8");
      chmodSync(env.app, 0o555);
      try {
        const r = install(env);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /could not back up/);
        assert.match(r.err, /install aborted: could not bind/);
        assert.doesNotMatch(r.out, /done\./);
        assert.equal(readFileSync(env.keys, "utf8"), before);
      } finally {
        chmodSync(env.app, 0o755);
      }
    },
  );

  test("a link at ~/.local/bin/cc-accounts that points elsewhere aborts and is left alone", () => {
    const env = setup();
    const elsewhere = join(root, `other-cc${n}`);
    writeFileSync(elsewhere, "#!/bin/sh\n");
    mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
    symlinkSync(elsewhere, join(env.home, ".local", "bin", "cc-accounts"));
    const r = install(env);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /points to another place/);
    assert.equal(readlinkSync(join(env.home, ".local", "bin", "cc-accounts")), elsewhere);
    assert.ok(!existsSync(join(env.app, "mods", "cc-accounts")));
    assert.deepEqual(readKeys(env.keys), SAMPLE_KEYS);
  });

  describe("--layout and --remove", () => {
    const withLayout = () => {
      const env = setup();
      mkdirSync(join(env.app, "layouts"));
      copyFileSync(
        join(REPO, "test", "fixtures", "layout-with-toggle-neighbor.json"),
        join(env.app, "layouts", "mine.json"),
      );
      writeFileSync(join(env.app, "shared.json"), JSON.stringify({ layout: "mine" }));
      return { ...env, layout: join(env.app, "layouts", "mine.json") };
    };
    const hasNodes = (file) => /cc-accounts-panel/.test(readFileSync(file, "utf8"));

    test("a plain install leaves the layout alone, --layout places the nodes and the mod gets its icon", () => {
      const env = withLayout();
      const original = readFileSync(env.layout, "utf8");
      assert.equal(install(env).code, 0);
      assert.equal(readFileSync(env.layout, "utf8"), original);
      const r = install(env, ["--layout"]);
      assert.equal(r.code, 0, r.err);
      assert.ok(hasNodes(env.layout));
      const mod = join(env.app, "mods", "cc-accounts");
      for (const file of [
        "main.js",
        "model.js",
        "mod.json",
        "icons/users.svg",
        "icons/plus.svg",
        "icons/fork.svg",
        "icons/log-in.svg",
        "icons/info.svg",
        "icons/close.svg",
        "icons/check.svg",
      ]) {
        assert.ok(existsSync(join(mod, file)), file);
      }
      writeFileSync(join(mod, "accounts.svg"), "<svg/>");
      assert.equal(install(env, ["--layout"]).code, 0);
      assert.ok(!existsSync(join(mod, "accounts.svg")), "the icon of the older version is removed");
      assert.equal(readdirSync(join(env.app, "layouts")).filter((x) => x.includes(".bak-")).length, 1);
    });

    test("--remove only takes the nodes out and leaves the link, the mod and the key", () => {
      const env = withLayout();
      const original = readFileSync(env.layout, "utf8");
      install(env, ["--layout"]);
      const r = install(env, ["--remove"]);
      assert.equal(r.code, 0, r.err);
      assert.equal(readFileSync(env.layout, "utf8"), original);
      assert.ok(existsSync(join(env.app, "mods", "cc-accounts", "main.js")));
      assert.equal(readKeys(env.keys).global[KEY], ACTION);
    });

    test("a layout that cannot take the nodes fails loudly after the install, and the flags exclude each other", () => {
      const env = withLayout();
      writeFileSync(env.layout, JSON.stringify({ id: "root", type: "row", children: [] }));
      const r = install(env, ["--layout"]);
      assert.notEqual(r.code, 0);
      assert.match(r.err, /layout was not changed/);
      assert.notEqual(install(env, ["--layout", "--remove"]).code, 0);
      assert.notEqual(install(env, ["--nope"]).code, 0);
    });
  });
});
