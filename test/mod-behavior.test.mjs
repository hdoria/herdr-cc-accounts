import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const MOD = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "cc-accounts");
const CLI = "/app/mods/cc-accounts/cc-accounts";
const SOURCE = readFileSync(join(MOD, "main.js"), "utf8");
const MODEL = await import(join(MOD, "model.js"));
const SESSION = { id: "123e4567-e89b-12d3-a456-426614174000", cwd: "/work/it's $(a) `b`" };
const DATA = "cc-accounts.data";
const LOCK = "cc-accounts.lock";

// Loads the mod's real source with the herdr, gpui-kit and gpui-base modules replaced by recordings.
// `store` stands for shared state and is common to every copy made from one world.
function load(world) {
  const calls = { run: [], exec: [], openOverlay: [], closeOverlay: [] };
  const texts = [];
  const builder = () => {
    const self = new Proxy(
      (...args) => {
        for (const a of args) if (typeof a === "string") texts.push(a);
        return self;
      },
      {
        get: (_, key) =>
          key === "when"
            ? (cond, fn) => {
                if (cond) fn(self);
                return self;
              }
            : self,
      },
    );
    return self;
  };
  world.store ??= new Map();
  const stubs = {
    "gpui-kit": { View: class {}, div: builder, svg: builder },
    "gpui-base": { v_flex: builder, h_flex: builder },
    "./model.js": MODEL,
    herdr: {
      exec: async (...args) => {
        calls.exec.push(args);
        return world.exec ? world.exec(...args) : { code: 1, stdout: "", stderr: "" };
      },
      layout: () => world.layout ?? null,
      terminals: () => world.terminals ?? [],
      panes: () => world.panes ?? [],
      spaces: () => world.spaces ?? [],
      focused: () => world.focused ?? null,
      run: (command, args) => calls.run.push([command, args]),
      props: () => world.props ?? null,
      openOverlay: (options) => calls.openOverlay.push(options),
      closeOverlay: (id) => calls.closeOverlay.push(id),
      checking: () => false,
      theme: () => new Proxy({}, { get: (_, key) => `#${String(key)}` }),
      settings: () => ({}),
      home: () => "/home/test",
      appHome: () => "/app",
      readTextFile: async () => null,
      shared: (key) => world.store.get(key) ?? null,
      setShared: (key, value) => {
        world.store.set(key, value);
        return null;
      },
    },
  };
  const source = SOURCE.replace(
    /^import \{([^}]*)\} from "([^"]+)";$/gm,
    (_, names, from) => `const {${names}} = stubs[${JSON.stringify(from)}];`,
  ).replace("export default class", "return class");
  const storage = world.storage ?? { getItem: () => null, setItem() {} };
  const Mod = new Function("stubs", "localStorage", source)(stubs, storage);
  const mod = Object.create(Mod.prototype);
  Object.assign(mod, { role: world.role ?? "menu", open: {} });
  return { mod, calls, texts };
}

const listing = (extra = {}) => JSON.stringify({ demo: false, accounts, ...extra });
const claude = (pid, address = "t1") => ({ address, foreground: { name: "claude", argv: ["claude"], pid } });
const focusOn = { terminal: "t1", pane: "p1", cwd: "/work" };
const accounts = [
  { name: "default", dir: null, email: "main@example.com", signedIn: true },
  { name: "spare", dir: "/x/spare", email: "spare@example.com", signedIn: true },
  { name: "fresh", dir: "/x/fresh", email: null, signedIn: false },
  { name: "busy", dir: "/x/busy", email: null, signedIn: false },
  { name: "work", dir: "/x/work", email: "work@example.com", signedIn: true },
];

// Three Claude panes: two in "work" (one is the focused one), one in "busy", which has no login.
const live = () => ({
  terminals: [claude(41, "t1"), claude(42, "t2"), claude(43, "t3")],
  panes: [
    { pane: "p1", terminal: "t1", tab: "tab1", title: "Claude Code", cwd: "/work/my-app", status: "working" },
    { pane: "p2", terminal: "t2", tab: "tab2", title: "x", cwd: "/work/site", status: "idle" },
    { pane: "p3", terminal: "t3", tab: "tab1", title: "y", cwd: "/work/api", status: null },
  ],
  spaces: [
    {
      id: "s1",
      name: "my-app",
      machine: null,
      tabs: [
        { id: "tab1", name: "claude-accounts" },
        { id: "tab2", name: "site" },
      ],
    },
  ],
  focused: focusOn,
});
const filled = (extra = {}) => ({
  ...live(),
  store: new Map([
    [
      DATA,
      {
        accounts,
        accountsAt: Date.now(),
        cli: CLI,
        byPid: { 41: "work", 42: "work", 43: "busy" },
        session: SESSION,
        focusPid: 41,
        error: null,
        key: "41|41,42,43",
        at: Date.now(),
      },
    ],
  ]),
  ...extra,
});

const cxFor = (extra = {}) => {
  const pending = [];
  const timers = [];
  const cx = {
    notify() {},
    sleep: async () => {},
    spawn: (fn) => {
      const p = fn(cx);
      pending.push(p);
      return p;
    },
    timer: { every: (ms, fn) => timers.push([ms, fn]) },
    ...extra,
  };
  return { cx, pending, timers };
};

describe("mod behavior", () => {
  let world;
  beforeEach(() => {
    world = { focused: focusOn, props: { overlay: 7 } };
  });

  test("continue opens the right pane with argv and the session folder, no shell in between", () => {
    const { mod, calls } = load(world);
    mod.continueHere("work", SESSION);
    assert.deepEqual(calls.run, [
      [
        "terminal.open",
        {
          place: "right",
          folder: SESSION.cwd,
          argv: [CLI, "run", "work", "--resume", SESSION.id, "--fork-session"],
        },
      ],
    ]);
    assert.deepEqual(calls.closeOverlay, [7]);
  });

  test("continue and new tab refuse an invalid account name or session id", () => {
    const { mod, calls } = load(world);
    mod.continueHere("work", { id: "not-a-uuid", cwd: "/x" });
    mod.continueHere("Bad Name; rm", SESSION);
    mod.continueHere("work", null);
    mod.newTab("-x y");
    assert.deepEqual(calls.run, []);
  });

  test("closing the popup tolerates props() returning nothing", () => {
    world.props = null;
    const { mod, calls } = load(world);
    mod.newTab("work");
    mod.continueHere("work", SESSION);
    assert.equal(calls.run.length, 2);
    assert.deepEqual(calls.closeOverlay, []);
  });

  test("Log in opens a tab in the account like New tab does", () => {
    const { mod, calls } = load(world);
    mod.logIn("fresh");
    mod.logIn("Bad Name");
    assert.deepEqual(calls.run, [["tab.new", { argv: [CLI, "run", "fresh"] }]]);
  });

  test("a pane whose foreground process is claude is focused, with its pid", () => {
    for (const foreground of [
      { name: "claude", argv: ["claude"], pid: 41 },
      { name: "node", argv: ["node", "/x/cc-accounts", "run", "work"], pid: 41 },
    ]) {
      world.terminals = [{ address: "t1", foreground }];
      assert.deepEqual(load(world).mod.focus(), { pid: 41, cwd: "/work" });
    }
  });

  test("a pane that only has claude in its arguments, or where claude exited, is not a claude", () => {
    for (const foreground of [
      { name: "vim", argv: ["vim", "/h/.claude/settings.json"], pid: 9 },
      { name: "zsh", argv: ["-zsh"], pid: 9 },
    ]) {
      world.terminals = [
        { address: "t1", foreground, program: { key: "claude", name: "Claude Code" }, name: "claude" },
      ];
      assert.equal(load(world).mod.focus(), null);
    }
  });

  test("the popup height is capped however many accounts there are", () => {
    const { mod, calls } = load(world);
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `a${i}`, dir: null, email: null, signedIn: true }));
    mod.openPopup({ accounts: many, counts: {}, current: null, session: null, error: null });
    assert.ok(calls.openOverlay[0].height <= 480, String(calls.openOverlay[0].height));
    mod.openPopup({ accounts: many.slice(0, 1), counts: {}, current: null, session: null, error: null });
    assert.ok(calls.openOverlay[1].height < 480);
    assert.deepEqual(calls.openOverlay[1].props.role, "menu");
  });

  const layoutWith = (hidden) => ({
    id: "root",
    children: [{ id: "work", children: [{ id: "cc-accounts-panel", hidden }] }],
  });

  test("the toggle button flips the panel node by its id", () => {
    const { mod, calls } = load(world);
    mod.togglePanel();
    assert.deepEqual(calls.run, [["layout.toggle", { id: "cc-accounts-panel" }]]);
  });

  test("a hidden panel runs no command, and reading again after it shows needs no focus change", async () => {
    world.role = "panel";
    world.terminals = [claude(41)];
    world.layout = layoutWith(true);
    world.exec = async (_c, args) => ({ code: 0, stdout: args[0] === "ls" ? listing() : "41 work\n", stderr: "" });
    const { mod, calls } = load(world);
    const { cx, pending } = cxFor();
    mod.sync(cx);
    mod.timerRead(cx);
    await Promise.all(pending);
    assert.deepEqual(calls.exec, []);
    world.layout = layoutWith(false);
    mod.sync(cx);
    await Promise.all(pending);
    assert.deepEqual(
      calls.exec.map(([, a]) => a[0]),
      ["ls", "which", "-P"],
    );
  });

  test("copies share one read: two copies, one `ls`, and the lock is released", async () => {
    world.terminals = [claude(41)];
    let ls = 0;
    world.exec = async (_c, args) => {
      if (args[0] === "ls") ls++;
      return { code: 0, stdout: args[0] === "ls" ? listing() : "41 work\n", stderr: "" };
    };
    const a = load(world);
    const b = load(world);
    a.mod.role = "toggle";
    b.mod.role = "panel";
    world.layout = layoutWith(false);
    const ca = cxFor();
    const cb = cxFor();
    a.mod.sync(ca.cx);
    b.mod.sync(cb.cx);
    await Promise.all([...ca.pending, ...cb.pending]);
    assert.equal(ls, 1);
    const data = world.store.get(DATA);
    assert.deepEqual(data.byPid, { 41: "work" });
    assert.equal(data.accounts.length, accounts.length);
    assert.equal(world.store.get(LOCK), null);
    // Nothing changed: neither copy reads again.
    a.mod.sync(ca.cx);
    b.mod.sync(cb.cx);
    await Promise.all([...ca.pending, ...cb.pending]);
    assert.equal(ls, 1);
  });

  test("a lock held by another copy blocks a read; an old lock does not", async () => {
    world.terminals = [claude(41)];
    world.exec = async (_c, args) => ({ code: 0, stdout: args[0] === "ls" ? listing() : "41 work\n", stderr: "" });
    world.store = new Map([[LOCK, { at: Date.now() }]]);
    const { mod, calls } = load(world);
    mod.role = "toggle";
    const { cx, pending } = cxFor();
    mod.sync(cx);
    await Promise.all(pending);
    assert.deepEqual(calls.exec, []);
    world.store.set(LOCK, { at: Date.now() - 60000 });
    mod.sync(cx);
    await Promise.all(pending);
    assert.ok(calls.exec.length > 0);
  });

  test("a change of Claude panes asks `which` again but reuses the fresh accounts", async () => {
    world = filled({ role: "toggle", props: null });
    world.exec = async () => ({ code: 0, stdout: "41 work\n42 work\n43 busy\n44 default\n", stderr: "" });
    world.terminals.push(claude(44, "t4"));
    const { mod, calls } = load(world);
    const { cx, pending } = cxFor();
    mod.sync(cx);
    await Promise.all(pending);
    const asked = calls.exec.filter(([c]) => c === CLI).map(([, a]) => a);
    assert.deepEqual(asked, [["which", "41", "42", "43", "44"]]);
    assert.equal(world.store.get(DATA).byPid[44], "default");
  });

  test("no one-second timer: a copy that reads keeps only the 30 second timer, and the popup none", () => {
    for (const [role, expected] of [
      ["toggle", [30000]],
      ["panel", [30000]],
      ["chip", [30000]],
      ["menu", []],
    ]) {
      world.props = { role };
      const { mod } = load(world);
      const { cx, timers } = cxFor();
      mod.init({}, cx);
      assert.deepEqual(
        timers.map(([ms]) => ms),
        expected,
        role,
      );
    }
  });

  test("one `which` call resolves every claude pane, and the counts and the focused account come from it", async () => {
    world.terminals = [
      claude(41, "t1"),
      { address: "t2", foreground: { name: "node", argv: ["node", "/x/cc-accounts", "run", "work"], pid: 42 } },
      claude(43, "t3"),
      { address: "t4", foreground: { name: "zsh", argv: ["-zsh"], pid: 44 } },
      claude(45, "m/t5"),
    ];
    const asked = [];
    world.exec = async (command, args) => {
      if (command === CLI) asked.push(args);
      return {
        code: command === CLI && args[0] === "which" ? 1 : 0,
        stdout: { ls: listing(), which: "41 work\n42 work\n43 default\n" }[args[0]] ?? "",
        stderr: "",
      };
    };
    const { mod } = load(world);
    mod.role = "toggle";
    const { cx, pending } = cxFor();
    mod.sync(cx);
    await Promise.all(pending);
    assert.deepEqual(asked, [
      ["ls", "--json"],
      ["which", "41", "42", "43"],
    ]);
    const data = world.store.get(DATA);
    assert.deepEqual(data.byPid, { 41: "work", 42: "work", 43: "default" });
    const v = mod.view();
    assert.deepEqual(v.counts, { work: 2, default: 1 });
    assert.equal(v.current, "work");
  });

  test("an `ls` that fails is shown as an error and read again later, not in a loop", async () => {
    world.terminals = [claude(41)];
    world.exec = async () => ({ code: 127, stdout: "", stderr: "cc-accounts: not found" });
    const { mod, calls } = load(world);
    mod.role = "toggle";
    const { cx, pending } = cxFor();
    mod.sync(cx);
    await Promise.all(pending);
    assert.equal(world.store.get(DATA).error, "cc-accounts is not on PATH");
    const runs = calls.exec.length;
    mod.sync(cx);
    await Promise.all(pending);
    assert.equal(calls.exec.length, runs);
  });

  test("the panel draws the numbers, the sections, the states in words and the right actions", () => {
    world = filled({ role: "panel", props: null, layout: layoutWith(false) });
    const { mod, texts } = load(world);
    mod.role = "panel";
    mod.render(cxFor().cx);
    for (const word of [
      "Claude accounts",
      "this pane · work",
      "Accounts",
      "In use",
      "Panes",
      "Needs login",
      "IN USE · 2",
      "SIGNED IN · 2",
      "NEEDS LOGIN · 1",
      "in use · needs login",
      "2 panes",
      "1 pane",
      "not logged in",
      "Open a tab and run /login",
      "New tab",
      "Continue here in a fork",
      "cc-accounts add <name>",
    ])
      assert.ok(texts.includes(word), `${word} missing from ${JSON.stringify(texts)}`);
    // The numbers: 5 accounts, 2 in use, 3 panes, 2 without a login.
    for (const n of ["5", "2", "3"]) assert.ok(texts.includes(n), n);
    // Log in on the two accounts without login, Continue on the three others but the focused one.
    assert.equal(texts.filter((x) => x === "Open a tab and run /login").length, 2);
    assert.equal(texts.filter((x) => x === "Continue here in a fork").length, 2);
  });

  test("a panel with nobody signed out has no Needs login card, and one with no Claude says so", () => {
    world = filled({ role: "panel", props: null, layout: layoutWith(false), focused: { terminal: "t9", pane: "p9" } });
    world.store.set(DATA, { ...world.store.get(DATA), accounts: accounts.filter((a) => a.signedIn) });
    const { mod, texts } = load(world);
    mod.role = "panel";
    mod.render(cxFor().cx);
    assert.ok(!texts.includes("Needs login"));
    assert.ok(texts.includes("no Claude here"));
    assert.ok(!texts.includes("Continue here in a fork"));
  });

  test("the focused pane's account starts open and lists its panes; the others stay closed", () => {
    world = filled({ role: "panel", props: null, layout: layoutWith(false) });
    const { mod, texts } = load(world);
    mod.role = "panel";
    mod.render(cxFor().cx);
    assert.ok(texts.includes("my-app › claude-accounts"));
    assert.ok(texts.includes("my-app › site"));
    assert.ok(texts.includes("Hide the panes"));
    assert.ok(texts.includes("Show the panes"));
    assert.equal(
      texts.filter((x) => x === "my-app › claude-accounts").length,
      1,
      "only work is open, busy's pane is not listed",
    );
  });

  test("the open state is saved per account, a failing storage changes nothing else, and a saved choice wins", () => {
    const saved = [];
    world = filled({
      role: "panel",
      storage: { getItem: () => JSON.stringify({ work: false, busy: true }), setItem: (k, v) => saved.push([k, v]) },
    });
    const first = load(world);
    first.mod.open = first.mod.loadOpen();
    assert.equal(first.mod.isOpen("work", true), false);
    assert.equal(first.mod.isOpen("busy", false), true);
    assert.equal(first.mod.isOpen("spare", false), false);
    assert.equal(first.mod.isOpen("spare", true), true);
    let notified = 0;
    first.mod.toggleOpen("work", true, { notify: () => notified++ });
    assert.equal(first.mod.isOpen("work", true), true);
    assert.deepEqual(saved, [["cc-accounts.open", JSON.stringify({ work: true, busy: true })]]);
    assert.equal(notified, 1);
    for (const broken of [
      {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
      { getItem: () => "{not json", setItem() {} },
      { getItem: () => "[1]", setItem() {} },
    ]) {
      const { mod } = load({ ...world, storage: broken });
      mod.open = mod.loadOpen();
      assert.deepEqual(mod.open, {});
      mod.toggleOpen("work", false, { notify() {} });
      assert.equal(mod.isOpen("work", false), true);
    }
  });

  test("clicking a pane goes to its space, its tab and the pane, in that order", () => {
    world = filled({ role: "panel", props: null });
    const { mod, calls } = load(world);
    mod.role = "panel";
    const [item] = mod.view().panesOf.work;
    mod.goTo(item);
    assert.deepEqual(calls.run, [
      ["space.select", { id: "s1" }],
      ["tab.select", { id: "tab1" }],
      ["pane.focus", { pane: "p1" }],
    ]);
    assert.equal(item.focused, true);
  });

  test("in the popup the pane count has a tooltip that lists the panes, and nothing expands", () => {
    world = filled({ role: "menu", props: { role: "menu", overlay: 3, current: "work" }, layout: null });
    const { mod, texts } = load(world);
    mod.render(cxFor().cx);
    assert.ok(texts.includes("my-app › claude-accounts · my-app\nmy-app › site · site"), JSON.stringify(texts));
    assert.ok(!texts.includes("Show the panes") && !texts.includes("Hide the panes"));
    assert.ok(!texts.includes("Accounts"), "the popup has no numbers strip");
    assert.ok(texts.includes("Open a tab and run /login"));
  });

  test("the button shows the account's name, or Accounts with the generic icon when the pane is not Claude", () => {
    world = filled({ role: "toggle", props: null, layout: layoutWith(false) });
    const here = load(world);
    here.mod.render(cxFor().cx);
    assert.ok(here.texts.includes("work") && here.texts.includes("work: in use · 2 panes"), JSON.stringify(here.texts));
    assert.ok(!here.texts.some((x) => x.startsWith("Claude")));
    world.focused = { terminal: "t9", pane: "p9" };
    const away = load(world);
    away.mod.render(cxFor().cx);
    assert.ok(away.texts.includes("Accounts") && away.texts.includes("Claude Code accounts"));
  });

  test("the popup opens with the frozen account and session of the pane it came from", () => {
    world = filled({
      role: "menu",
      props: { role: "menu", overlay: 3, current: "spare", session: SESSION },
      layout: null,
    });
    const { mod } = load(world);
    const v = mod.view();
    assert.equal(v.current, "spare");
    assert.deepEqual(v.session, SESSION);
  });

  describe("demo mode", () => {
    const demoStore = () =>
      new Map([
        [
          DATA,
          {
            accounts: [
              { name: "personal", signedIn: true },
              { name: "client", signedIn: false },
              { name: "work", signedIn: true },
            ].map((a) => ({ ...a, email: `${a.name}@example.com` })),
            accountsAt: Date.now(),
            demo: true,
            cli: CLI,
            byPid: {},
            session: null,
            focusPid: null,
            error: null,
            key: "41|41",
            at: Date.now(),
          },
        ],
      ]);

    test("the panel draws the sample panes, never the real spaces, folders or accounts", () => {
      world = { ...live(), role: "panel", props: null, layout: layoutWith(false), store: demoStore() };
      const { mod, texts } = load(world);
      mod.role = "panel";
      mod.render(cxFor().cx);
      const drawn = JSON.stringify(texts);
      for (const word of [
        "api-server › claude",
        "web-app › claude",
        "work@example.com",
        "personal@example.com",
        "IN USE · 1",
        "SIGNED IN · 1",
        "NEEDS LOGIN · 1",
        "2 panes",
      ]) {
        assert.ok(texts.includes(word), `${word} missing from ${drawn}`);
      }
      for (const real of ["my-app", "claude-accounts", "main@example.com", "/work", "site"])
        assert.ok(!drawn.includes(real), `${real} leaked into ${drawn}`);
    });

    test("clicks do nothing: no tab, no fork, no jump to a pane", () => {
      world = { ...live(), props: { overlay: 7 }, store: demoStore() };
      const { mod, calls } = load(world);
      mod.newTab("work");
      mod.logIn("client");
      mod.continueHere("personal", mod.view().session);
      mod.goTo(mod.view().panesOf.work[0]);
      assert.deepEqual(calls.run, []);
      assert.deepEqual(calls.closeOverlay, []);
    });

    test("a read in demo mode runs `ls` only: no `which`, no session lookup, and no pid is stored", async () => {
      world = { ...live(), role: "toggle", props: null, layout: layoutWith(false) };
      world.exec = async (_c, args) => ({
        code: 0,
        stdout: args[0] === "ls" ? listing({ demo: true }) : "41 work\n",
        stderr: "",
      });
      const { mod, calls } = load(world);
      const { cx, pending } = cxFor();
      mod.sync(cx);
      await Promise.all(pending);
      assert.deepEqual(
        calls.exec.map(([, a]) => a),
        [["ls", "--json"]],
      );
      const data = world.store.get(DATA);
      assert.equal(data.demo, true);
      assert.deepEqual(data.byPid, {});
      assert.equal(data.session, null);
      assert.equal(mod.view().current, "work");
    });
  });

  test("the CLI that answered is the one `run` uses, and a copy under another name falls back to the PATH", async () => {
    world.terminals = [claude(41)];
    world.exec = async (command, args) => {
      if (command === CLI) throw new Error("spawn ENOENT");
      return { code: 0, stdout: args[0] === "ls" ? listing() : "41 work\n", stderr: "" };
    };
    const { mod, calls } = load(world);
    mod.role = "toggle";
    const { cx, pending } = cxFor();
    mod.sync(cx);
    await Promise.all(pending);
    assert.deepEqual(
      calls.exec.map(([c]) => c),
      [CLI, "cc-accounts", "cc-accounts", "pgrep"],
    );
    assert.equal(world.store.get(DATA).cli, "cc-accounts");
    mod.newTab("work");
    assert.deepEqual(calls.run, [["tab.new", { argv: ["cc-accounts", "run", "work"] }]]);
  });

  test("when no copy of the CLI can start the error says so and the next read tries both again", async () => {
    world.terminals = [claude(41)];
    world.exec = async () => {
      throw new Error("spawn ENOENT");
    };
    const { mod } = load(world);
    mod.role = "toggle";
    const { cx, pending } = cxFor();
    mod.sync(cx);
    await Promise.all(pending);
    const data = world.store.get(DATA);
    assert.equal(data.error, "cc-accounts is not on PATH");
    assert.equal(data.cli, null);
  });
});
