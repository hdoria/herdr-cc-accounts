import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const MOD = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "cc-accounts");
const hasHerdr = spawnSync("herdr-app", ["--version"], { encoding: "utf8" }).status === 0;

// herdr-app check writes under $HOME/Library/Application Support, so it gets a throwaway HOME. It runs the
// mod once and needs nothing else from the real one (verified: it passes with an empty HOME).
const herdrEnv = () => ({ ...process.env, HOME: join(root, "home"), HERDR_APP_HOME: join(root, "app-home") });

// Three states: "default" and "spare" are signed in, "work" and "busy" have no login, and "busy" has a pane.
const ACCOUNTS = [
  { name: "default", dir: null, email: "main@example.com", signedIn: true },
  { name: "work", dir: "/tmp/.claude-accounts/work", email: null, signedIn: false },
  { name: "spare", dir: "/tmp/.claude-accounts/spare", email: "spare@example.com", signedIn: true },
  { name: "busy", dir: "/tmp/.claude-accounts/busy", email: null, signedIn: false },
];
const SESSION = { id: "123e4567-e89b-12d3-a456-426614174000", cwd: "/tmp" };
const COUNTS = { default: 2, busy: 1 };

let root;
let n = 0;

// herdr-app check cannot pass props to a mod, so each case checks a copy whose props() returns fixed values.
function check(props) {
  const dir = join(root, `mod${n++}`);
  cpSync(MOD, dir, { recursive: true });
  const file = join(dir, "main.js");
  const source = readFileSync(file, "utf8");
  assert.ok(source.includes("props()"), "the mod no longer calls props()");
  writeFileSync(
    file,
    `const fixedProps = () => (${JSON.stringify(props)});\n${source.replaceAll("props()", "fixedProps()")}`,
  );
  const r = spawnSync("herdr-app", ["check", dir], {
    env: herdrEnv(),
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "cc-accounts-mod-"));
  mkdirSync(join(root, "home"));
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("mod", { skip: !hasHerdr && "herdr-app is not installed" }, () => {
  test("the mod as shipped passes herdr-app check", () => {
    const dir = join(root, "shipped");
    cpSync(MOD, dir, { recursive: true });
    const r = spawnSync("herdr-app", ["check", dir], { env: herdrEnv(), encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  const fixed = (role, extra = {}) => ({
    role,
    accounts: ACCOUNTS,
    current: "default",
    session: SESSION,
    counts: COUNTS,
    error: null,
    ...extra,
  });

  test("the chip role renders with and without an account, and when the CLI failed", () => {
    assert.equal(check(fixed("chip")).code, 0);
    assert.equal(check(fixed("chip", { current: null })).code, 0);
    assert.equal(
      check(
        fixed("chip", { accounts: [], current: null, session: null, counts: {}, error: "cc-accounts is not on PATH" }),
      ).code,
      0,
    );
  });

  test("the toggle role renders with an account, without one and with an error", () => {
    for (const current of ["busy", null]) {
      const r = check(fixed("toggle", { current }));
      assert.equal(r.code, 0, r.out);
    }
    assert.equal(
      check(
        fixed("toggle", {
          accounts: [],
          current: null,
          session: null,
          counts: {},
          error: "cc-accounts is not on PATH",
        }),
      ).code,
      0,
    );
  });

  test("the panel role renders the three states, the numbers, a session to continue and an error line", () => {
    for (const error of [null, "something failed"]) {
      const r = check(fixed("panel", { error }));
      assert.equal(r.code, 0, r.out);
    }
    assert.equal(check(fixed("panel", { current: null, session: null })).code, 0);
    assert.equal(check(fixed("panel", { accounts: [], current: null, session: null, counts: {} })).code, 0);
    assert.equal(check(fixed("panel", { accounts: ACCOUNTS.filter((a) => a.signedIn), counts: {} })).code, 0);
  });

  test("the menu role renders the three states, a session to continue and an error line", () => {
    for (const error of [null, "something failed"]) {
      const r = check(fixed("menu", { error }));
      assert.equal(r.code, 0, r.out);
    }
  });

  test("the files the installer copies are all there", () => {
    for (const file of [
      "main.js",
      "model.js",
      "cli.js",
      "cc-accounts",
      "mod.json",
      "RECIPE.md",
      ...["users", "plus", "fork", "log-in", "info", "close", "check", "chevron-right", "chevron-down"].map(
        (n) => `icons/${n}.svg`,
      ),
    ]) {
      assert.ok(existsSync(join(MOD, file)), file);
    }
    for (const svg of readdirSync(join(MOD, "icons"))) {
      const text = readFileSync(join(MOD, "icons", svg), "utf8");
      assert.match(text, /viewBox="0 0 24 24"/);
      assert.match(text, /stroke-width="1.5"/);
      assert.match(text, /stroke="currentColor"/);
    }
  });
});
