import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO, "scripts", "place-layout.mjs");
const lib = await import(pathToFileURL(SCRIPT));
const fixture = (name) => join(REPO, "test", "fixtures", `layout-${name}.json`);

let root;
let n = 0;

const copyOf = (name) => {
  const file = join(root, `l${n++}.json`);
  copyFileSync(fixture(name), file);
  return file;
};
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const place = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: root },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const backups = (file) => readdirSync(dirname(file)).filter((x) => x.startsWith(`${file.split("/").pop()}.bak-`));
const ids = (node, found = []) => {
  found.push(node.id);
  for (const child of node.children ?? []) ids(child, found);
  return found;
};
const childrenOf = (layout, id) => {
  const stack = [layout];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.id === id) return node.children.map((c) => c.id);
    stack.push(...(node.children ?? []));
  }
  return null;
};

before(() => {
  root = mkdtempSync(join(tmpdir(), "cc-accounts-layout-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("place-layout", () => {
  test("puts the toggle before the neighbor's toggle and the panel right after the main block", () => {
    const file = copyOf("with-toggle-neighbor");
    const r = place(["apply", "--file", file]);
    assert.equal(r.code, 0, r.err);
    const layout = read(file);
    assert.deepEqual(childrenOf(layout, "tabs-row"), ["tabs", "cc-accounts-toggle", "skillshare-toggle"]);
    assert.deepEqual(childrenOf(layout, "work-body"), ["main", "cc-accounts-panel", "panel", "skillshare-panel"]);
    const toggle = layout.children[1].children[0].children[1];
    assert.deepEqual(toggle, {
      id: "cc-accounts-toggle",
      type: "block",
      content: { mod: "cc-accounts", props: { role: "toggle" } },
      size: { px: 140 },
    });
    const panel = layout.children[1].children[1].children[1];
    assert.deepEqual(
      { ...panel, children: undefined },
      {
        id: "cc-accounts-panel",
        type: "column",
        hidden: true,
        size: { px: 360 },
        min: 300,
        max: 600,
        children: undefined,
      },
    );
    assert.deepEqual(panel.children[0].content, { mod: "cc-accounts", props: { role: "panel" } });
  });

  test("without a neighbor the toggle goes to the end of the row", () => {
    const file = copyOf("plain-tab-row");
    assert.equal(place(["apply", "--file", file]).code, 0);
    assert.deepEqual(childrenOf(read(file), "tabs-row"), ["tabs", "cc-accounts-toggle"]);
  });

  test("a second apply changes nothing and makes no backup", () => {
    const file = copyOf("with-toggle-neighbor");
    place(["apply", "--file", file]);
    const once = readFileSync(file, "utf8");
    const r = place(["apply", "--file", file]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /already in place/);
    assert.equal(readFileSync(file, "utf8"), once);
    assert.equal(backups(file).length, 1);
  });

  test("apply leaves everything else in the file as it was, and remove restores the original content", () => {
    for (const name of ["with-toggle-neighbor", "plain-tab-row"]) {
      const file = copyOf(name);
      const original = readFileSync(file, "utf8");
      place(["apply", "--file", file]);
      assert.notEqual(readFileSync(file, "utf8"), original);
      const r = place(["remove", "--file", file]);
      assert.equal(r.code, 0, r.err);
      assert.equal(readFileSync(file, "utf8"), original, name);
    }
  });

  test("remove on a layout that never had the nodes does nothing", () => {
    const file = copyOf("plain-tab-row");
    const original = readFileSync(file, "utf8");
    const r = place(["remove", "--file", file]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /nothing to remove/);
    assert.equal(readFileSync(file, "utf8"), original);
    assert.deepEqual(backups(file), []);
  });

  test("remove takes out only the nodes it inserted", () => {
    const file = copyOf("with-toggle-neighbor");
    place(["apply", "--file", file]);
    const layout = read(file);
    layout.children[1].children[1].children.push({ id: "mine", type: "block", content: { mod: "files" } });
    writeFileSync(file, `${JSON.stringify(layout, null, 2)}\n`);
    place(["remove", "--file", file]);
    const after = read(file);
    assert.ok(!ids(after).some((id) => id.startsWith("cc-accounts")));
    assert.ok(ids(after).includes("mine"));
    assert.ok(ids(after).includes("skillshare-toggle"));
  });

  test("a node with our id and other content aborts both apply and remove, and the file is untouched", () => {
    for (const id of ["cc-accounts-toggle", "cc-accounts-panel", "cc-accounts"]) {
      const file = copyOf("with-toggle-neighbor");
      const layout = read(file);
      layout.children[1].children[1].children.push({ id, type: "block", content: { mod: "somebody-else" } });
      writeFileSync(file, `${JSON.stringify(layout, null, 2)}\n`);
      const before = readFileSync(file, "utf8");
      const applied = place(["apply", "--file", file]);
      assert.equal(applied.code, 1, id);
      assert.match(applied.err, /different content/);
      assert.equal(readFileSync(file, "utf8"), before);
      if (id !== "cc-accounts") {
        const removed = place(["remove", "--file", file]);
        assert.equal(removed.code, 1, id);
        assert.match(removed.err, /remove it by hand/);
      }
      assert.equal(readFileSync(file, "utf8"), before);
      assert.deepEqual(backups(file), []);
    }
  });

  test("a hand-edited copy of our toggle aborts apply even when the panel is missing, with no partial write", () => {
    const file = copyOf("plain-tab-row");
    place(["apply", "--file", file]);
    const layout = read(file);
    layout.children[1].children[0].children[1].size.px = 200;
    layout.children[1].children[1].children.splice(1, 1);
    writeFileSync(file, `${JSON.stringify(layout, null, 2)}\n`);
    const before = readFileSync(file, "utf8");
    assert.equal(place(["apply", "--file", file]).code, 1);
    assert.equal(readFileSync(file, "utf8"), before);
  });

  test("a layout whose tab bar is not in a row (the shipped main) aborts and explains", () => {
    const file = copyOf("shipped-main");
    const before = readFileSync(file, "utf8");
    const r = place(["apply", "--file", file]);
    assert.equal(r.code, 1);
    assert.match(r.err, /no row of the layout holds the "tabs" block/);
    assert.match(r.err, /clone the layout first/);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.deepEqual(backups(file), []);
  });

  test("a missing panel target aborts before the toggle is written", () => {
    const file = copyOf("plain-tab-row");
    const layout = read(file);
    layout.children[1].children[1].children[0].content = { mod: "elsewhere" };
    writeFileSync(file, `${JSON.stringify(layout, null, 2)}\n`);
    const before = readFileSync(file, "utf8");
    const r = place(["apply", "--file", file]);
    assert.equal(r.code, 1);
    assert.match(r.err, /active tab/);
    assert.equal(readFileSync(file, "utf8"), before);
  });

  test("it backs up, writes through a symbolic link and keeps the mode", () => {
    const real = copyOf("with-toggle-neighbor");
    chmodSync(real, 0o640);
    const link = join(root, `link${n++}.json`);
    symlinkSync(real, link);
    const r = place(["apply", "--file", link]);
    assert.equal(r.code, 0, r.err);
    assert.ok(statSync(link).isFile());
    assert.equal(statSync(real).mode & 0o777, 0o640);
    assert.equal(backups(real).length, 1);
    assert.ok(ids(read(real)).includes("cc-accounts-panel"));
    assert.deepEqual(
      readdirSync(root).filter((x) => x.endsWith(".tmp")),
      [],
    );
  });

  test("it finds the shown layout in the app folder's shared.json", () => {
    const app = join(root, `app${n++}`);
    mkdirSync(join(app, "layouts"), { recursive: true });
    copyFileSync(fixture("plain-tab-row"), join(app, "layouts", "mine.json"));
    writeFileSync(join(app, "shared.json"), JSON.stringify({ layout: "mine", other: 1 }));
    const r = place(["apply", "--app", app]);
    assert.equal(r.code, 0, r.err);
    assert.ok(ids(read(join(app, "layouts", "mine.json"))).includes("cc-accounts-toggle"));
  });

  test("without a way to tell the shown layout it asks for --file", () => {
    const app = join(root, `app${n++}`);
    mkdirSync(app);
    const r = place(["apply", "--app", app]);
    assert.equal(r.code, 1);
    assert.match(r.err, /--file/);
    writeFileSync(join(app, "shared.json"), JSON.stringify({ layout: "../escape" }));
    assert.equal(place(["apply", "--app", app]).code, 1);
  });

  test("--dry-run prints the result and writes nothing", () => {
    const file = copyOf("with-toggle-neighbor");
    const before = readFileSync(file, "utf8");
    const r = place(["apply", "--file", file, "--dry-run"]);
    assert.equal(r.code, 0, r.err);
    assert.ok(ids(JSON.parse(r.out)).includes("cc-accounts-panel"));
    assert.equal(readFileSync(file, "utf8"), before);
    assert.deepEqual(backups(file), []);
  });

  test("an invalid layout file aborts", () => {
    const file = join(root, `bad${n++}.json`);
    writeFileSync(file, "{ broken");
    assert.equal(place(["apply", "--file", file]).code, 1);
    assert.equal(readFileSync(file, "utf8"), "{ broken");
  });

  test("an unknown argument or command exits with code 2 and writes nothing", () => {
    const file = copyOf("plain-tab-row");
    const before = readFileSync(file, "utf8");
    for (const args of [
      ["apply", "--file", file, "--nope"],
      ["apply", "extra", "--file", file],
      ["explode", "--file", file],
      [],
      ["apply", "--file"],
    ]) {
      const r = place(args);
      assert.equal(r.code, 2, `${args.join(" ")}: ${r.err}`);
    }
    assert.equal(readFileSync(file, "utf8"), before);
  });

  test("the layouts Herdr ships are refused by name, by --file and by shared.json, for apply and remove", () => {
    for (const name of ["main", "terminals", "win98"]) {
      const app = join(root, `app${n++}`);
      mkdirSync(join(app, "layouts"), { recursive: true });
      const file = join(app, "layouts", `${name}.json`);
      copyFileSync(fixture("plain-tab-row"), file);
      writeFileSync(join(app, "shared.json"), JSON.stringify({ layout: name }));
      const before = readFileSync(file, "utf8");
      for (const args of [
        ["apply", "--file", file],
        ["apply", "--app", app],
        ["remove", "--file", file],
      ]) {
        const r = place(args);
        assert.equal(r.code, 1, `${name} ${args[0]}`);
        assert.match(r.err, /is a Herdr layout/);
        assert.match(r.err, /clone the layout first/);
      }
      assert.equal(readFileSync(file, "utf8"), before);
      assert.deepEqual(backups(file), []);
    }
  });

  test("backups carry milliseconds and random bytes, so two in the same instant differ", () => {
    const names = new Set(Array.from({ length: 50 }, () => lib.backupPath("/x/layout.json")));
    assert.equal(names.size, 50);
    for (const name of names) assert.match(name, /^\/x\/layout\.json\.bak-\d{13}-[0-9a-f]{6}$/);
    const file = copyOf("plain-tab-row");
    place(["apply", "--file", file]);
    assert.match(backups(file)[0], /\.bak-\d{13}-[0-9a-f]{6}$/);
  });

  test("an existing backup is never overwritten, and the layout stays as it was", () => {
    const file = copyOf("plain-tab-row");
    const original = readFileSync(file, "utf8");
    const taken = `${file}.bak-taken`;
    writeFileSync(taken, "precious");
    assert.throws(
      () => lib.writeLayout(file, "{}\n", lib.fingerprint(file), { backupAs: taken }),
      /could not back up .*EEXIST/,
    );
    assert.equal(readFileSync(taken, "utf8"), "precious");
    assert.equal(readFileSync(file, "utf8"), original);
  });

  test("a change to the layout between the read and the rename aborts the write and leaves the other writer's file", () => {
    const file = copyOf("plain-tab-row");
    const seen = lib.fingerprint(file);
    const theirs = `${JSON.stringify({ id: "theirs" })}\n`;
    assert.throws(
      () => lib.writeLayout(file, "{}\n", seen, { beforeRename: () => writeFileSync(file, theirs) }),
      /changed while it was being edited/,
    );
    assert.equal(readFileSync(file, "utf8"), theirs);
    assert.deepEqual(
      readdirSync(root).filter((x) => x.endsWith(".tmp")),
      [],
    );
  });

  test("an unchanged file is written, with a backup of the original", () => {
    const file = copyOf("plain-tab-row");
    const original = readFileSync(file, "utf8");
    const backup = lib.writeLayout(file, "{}\n", lib.fingerprint(file));
    assert.equal(readFileSync(file, "utf8"), "{}\n");
    assert.equal(readFileSync(backup, "utf8"), original);
  });

  test("a toggle written by an older version is resized, and remove still takes it out", () => {
    const file = copyOf("with-toggle-neighbor");
    place(["apply", "--file", file]);
    const layout = read(file);
    layout.children[1].children[0].children[1].size.px = 150;
    writeFileSync(file, `${JSON.stringify(layout, null, 2)}\n`);
    const old = readFileSync(file, "utf8");
    const r = place(["apply", "--file", file]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /toggle resized to 140 px/);
    assert.equal(read(file).children[1].children[0].children[1].size.px, 140);
    writeFileSync(file, old);
    assert.equal(place(["remove", "--file", file]).code, 0);
    assert.ok(!ids(read(file)).some((id) => id.startsWith("cc-accounts")));
  });
});
