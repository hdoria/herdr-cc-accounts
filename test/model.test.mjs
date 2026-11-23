import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_POPUP_HEIGHT,
  accountPanes,
  accountStatus,
  avatarSlot,
  claudePid,
  cliCandidates,
  countPanes,
  demoView,
  goToCommands,
  groupAccounts,
  paneTooltip,
  parseListing,
  parseWhich,
  popupHeight,
  readDue,
  readKey,
  stats,
} from "../mods/cc-accounts/model.js";

const fg = (name, argv, pid = 41) => ({ address: "t1", foreground: { name, argv, pid } });

describe("claudePid", () => {
  test("claude itself and the cc-accounts run wrapper are Claude panes", () => {
    for (const t of [
      fg("claude", ["claude"]),
      fg("node", ["/usr/local/bin/claude", "--resume"]),
      fg("2.1.330", ["claude"]),
      fg("node", ["node", "/x/bin/cc-accounts", "run", "work"]),
      fg("node", ["node", "/x/cc-accounts", "run", "work", "--resume", "abc"]),
    ])
      assert.equal(claudePid(t), 41, JSON.stringify(t));
  });

  test("a program that only mentions claude or cc-accounts in its arguments is not Claude", () => {
    for (const t of [
      fg("vim", ["vim", "/home/x/.claude/settings.json"]),
      fg("less", ["less", "claude.log"]),
      fg("node", ["node", "/x/bin/cc-accounts", "ls"]),
      fg("node", ["node", "/x/bin/cc-accounts", "which", "9"]),
      fg("node", ["node", "/x/bin/not-cc-accounts", "run", "work"]),
      fg("zsh", ["-zsh"]),
      fg("grep", ["grep", "claude", "run"]),
    ])
      assert.equal(claudePid(t), null, JSON.stringify(t));
  });

  test("a terminal without a foreground pid, or one whose Claude already exited, is not Claude", () => {
    assert.equal(claudePid({ address: "t1" }), null);
    assert.equal(
      claudePid({
        address: "t1",
        name: "claude",
        program: { key: "claude" },
        foreground: { name: "zsh", argv: ["-zsh"], pid: 9 },
      }),
      null,
    );
  });
});

describe("account state and grouping", () => {
  const accounts = [
    { name: "default", signedIn: true },
    { name: "spare", signedIn: true },
    { name: "fresh", signedIn: false },
    { name: "busy", signedIn: false },
    { name: "work", signedIn: true },
  ];

  test("labels: in use with a count, in use without a login, signed in, needs login", () => {
    assert.equal(accountStatus(accounts[4], 2).label, "in use · 2 panes");
    assert.equal(accountStatus(accounts[0], 1).label, "in use · 1 pane");
    assert.equal(accountStatus(accounts[3], 1).label, "in use · needs login");
    assert.equal(accountStatus(accounts[2], 0).label, "needs login");
    assert.equal(accountStatus(accounts[1], 0).label, "signed in");
    assert.equal(accountStatus({ name: "old" }, 0).key, "needs login");
  });

  test("sections hold in use, signed in, needs login in that order, the focused account first, empty ones left out", () => {
    const counts = { work: 1, spare: 3, busy: 1 };
    const sections = groupAccounts(accounts, counts, "work");
    assert.deepEqual(
      sections.map((s) => [s.title, s.items.map((a) => a.name)]),
      [
        ["IN USE", ["work", "spare", "busy"]],
        ["SIGNED IN", ["default"]],
        ["NEEDS LOGIN", ["fresh"]],
      ],
    );
    assert.deepEqual(
      groupAccounts(accounts.slice(0, 2), {}, null).map((s) => s.title),
      ["SIGNED IN"],
    );
    assert.deepEqual(groupAccounts([], {}, null), []);
  });

  test("the numbers: accounts, in use, panes, and accounts without a login", () => {
    assert.deepEqual(stats(accounts, { work: 2, busy: 1, gone: 4 }), {
      accounts: 5,
      inUse: 2,
      panes: 3,
      needsLogin: 2,
    });
  });

  test("an account's avatar color is stable, one of six slots, and the names spread over them", () => {
    assert.equal(avatarSlot("work"), avatarSlot("work"));
    const slots = new Set(
      ["default", "work", "spare", "personal", "client-a", "client-b", "a", "b", "c", "d", "e", "f"].map(avatarSlot),
    );
    for (const slot of slots) assert.ok(slot >= 1 && slot <= 6);
    assert.ok(slots.size >= 3, [...slots].join());
  });

  test("the popup height grows with the accounts and stops at the cap", () => {
    const one = groupAccounts(accounts.slice(0, 1), {}, null);
    const many = groupAccounts(
      Array.from({ length: 60 }, (_, i) => ({ name: `a${i}`, signedIn: true })),
      {},
      null,
    );
    assert.ok(popupHeight(one, null) < popupHeight(groupAccounts(accounts, {}, null), null));
    assert.equal(popupHeight(many, null), MAX_POPUP_HEIGHT);
  });

  test("a read is due without data, when the key changed, or when it aged out", () => {
    const key = readKey(41, [43, 41]);
    assert.equal(key, "41|41,43");
    const data = { key, at: 1000 };
    assert.equal(readDue(null, key, 1000, 30000), true);
    assert.equal(readDue(data, key, 2000, 30000), false);
    assert.equal(readDue(data, readKey(41, [41]), 2000, 30000), true);
    assert.equal(readDue(data, key, 40000, 30000), true);
  });
});

describe("which panes use which account", () => {
  const terminals = [
    { address: "t1", foreground: { name: "claude", argv: ["claude"], pid: 41 } },
    { address: "t2", foreground: { name: "node", argv: ["node", "/x/cc-accounts", "run", "work"], pid: 42 } },
    { address: "t3", foreground: { name: "claude", argv: ["claude"], pid: 43 } },
    { address: "t4", foreground: { name: "zsh", argv: ["-zsh"], pid: 44 } },
    { address: "box/t5", foreground: { name: "claude", argv: ["claude"], pid: 45 } },
    { address: "t6", foreground: { name: "claude", argv: ["claude"], pid: 46 } },
  ];
  const panes = [
    { pane: "p1", terminal: "t1", tab: "tab1", title: "Claude Code", cwd: "/work/my-app", status: "working" },
    { pane: "p2", terminal: "t2", tab: "tab2", title: "x", cwd: null, status: null },
    { pane: "p3", terminal: "t3", tab: "tab1", title: "fix it", cwd: "/", status: "idle" },
    { pane: "p6", terminal: "t6", tab: "tab9", title: "elsewhere", cwd: "/r", status: "done" },
  ];
  const spaces = [
    {
      id: "s1",
      name: "my-app",
      machine: null,
      tabs: [
        { id: "tab1", name: "claude-accounts" },
        { id: "tab2", name: "2" },
      ],
    },
    { id: "s2", name: "remote", machine: "box", tabs: [{ id: "tab9", name: "1" }] },
  ];
  const byPid = { 41: "work", 42: "work", 43: "default", 45: "work", 46: "work" };

  test("panes are grouped by account with space, tab, folder or title, status and the focused mark", () => {
    const got = accountPanes({ terminals, panes, spaces, byPid, focus: { pane: "p1", terminal: "t1" } });
    assert.deepEqual(Object.keys(got).sort(), ["default", "work"]);
    assert.deepEqual(
      got.work.map((i) => [i.pane, i.where, i.detail, i.status, i.focused]),
      [
        ["p1", "my-app › claude-accounts", "my-app", "working", true],
        ["p2", "my-app › 2", "x", null, false],
      ],
    );
    assert.deepEqual(
      got.default.map((i) => [i.pane, i.detail, i.status]),
      [["p3", "fix it", "idle"]],
    );
  });

  test("a pane of another machine, a pane with no account yet and a terminal in no pane are left out", () => {
    const got = accountPanes({ terminals, panes, spaces, byPid: { 41: "work" }, focus: null });
    assert.deepEqual(
      got.work.map((i) => i.pane),
      ["p1"],
    );
    assert.equal(got.default, undefined);
    const remote = accountPanes({ terminals, panes, spaces, byPid, focus: null });
    assert.ok(
      !Object.values(remote)
        .flat()
        .some((i) => i.terminal === "t6" || i.terminal === "box/t5"),
    );
  });

  test("the counts come from the live Claude panes, each pid once", () => {
    const local = Object.fromEntries(Object.entries(byPid).filter(([pid]) => pid !== "46"));
    assert.deepEqual(countPanes(terminals, local), { work: 2, default: 1 });
    assert.deepEqual(
      countPanes([...terminals, { address: "t7", foreground: { name: "claude", argv: ["claude"], pid: 41 } }], local),
      { work: 2, default: 1 },
    );
  });

  test("a click goes to the space, then the tab, then the pane; without a pane it focuses the terminal", () => {
    const [item] = accountPanes({ terminals, panes, spaces, byPid, focus: null }).work;
    assert.deepEqual(goToCommands(item), [
      ["space.select", { id: "s1" }],
      ["tab.select", { id: "tab1" }],
      ["pane.focus", { pane: "p1" }],
    ]);
    assert.deepEqual(goToCommands({ ...item, pane: null }).at(-1), ["pane.focus", { terminal: "t1" }]);
  });

  test("the tooltip lists one line per pane and shortens long ones", () => {
    const tip = paneTooltip([
      { where: "my-app › tab", detail: "folder" },
      { where: "x".repeat(80), detail: "" },
    ]).split("\n");
    assert.equal(tip[0], "my-app › tab · folder");
    assert.ok(tip[1].length <= 48 && tip[1].endsWith("…"));
  });

  test("which output keeps only known accounts", () => {
    assert.deepEqual(parseWhich("41 work\n42 unknown\n43 ghost\nnoise\n", [{ name: "work" }]), { 41: "work" });
  });
});

describe("the CLI the mod runs", () => {
  test("the copy in the mod's own folder comes first and the PATH is the fallback", () => {
    assert.deepEqual(cliCandidates("/home/x/.config/herdr-app"), [
      "/home/x/.config/herdr-app/mods/cc-accounts/cc-accounts",
      "cc-accounts",
    ]);
  });

  test("the listing is { demo, accounts }; the bare list of an older CLI still reads", () => {
    const accounts = [{ name: "work", signedIn: true }, { name: "Bad Name" }, null];
    assert.deepEqual(parseListing(JSON.stringify({ demo: true, accounts })), { demo: true, accounts: [accounts[0]] });
    assert.deepEqual(parseListing(JSON.stringify({ demo: false, accounts })).demo, false);
    assert.deepEqual(parseListing(JSON.stringify(accounts)), { demo: false, accounts: [accounts[0]] });
    assert.deepEqual(parseListing(JSON.stringify({ accounts: [] })), { demo: false, accounts: [] });
    for (const bad of ["{}", "null", '{"accounts":"x"}'])
      assert.throws(() => parseListing(bad), /not a list of accounts/);
    assert.throws(() => parseListing("not json"));
  });
});

describe("demoView", () => {
  const accounts = [
    { name: "personal", signedIn: true },
    { name: "client", signedIn: false },
    { name: "work", signedIn: true },
  ];

  test("work is in use in two sample panes of the spaces api-server and web-app", () => {
    const v = demoView(accounts);
    assert.deepEqual(v.counts, { work: 2 });
    assert.equal(v.current, "work");
    assert.deepEqual(
      v.panesOf.work.map((p) => p.where),
      ["api-server › claude", "web-app › claude"],
    );
    assert.deepEqual(
      v.panesOf.work.map((p) => p.status),
      ["working", "blocked"],
    );
    assert.equal(v.panesOf.work.filter((p) => p.focused).length, 1);
    assert.equal(v.accounts, accounts);
    assert.equal(accountStatus(accounts[2], 2).key, "in use");
  });

  test("it carries only invented data: no home folder, no real path, a session of nil ids", () => {
    const text = JSON.stringify(demoView(accounts));
    assert.ok(!/\/Users\/|\/home\/(?!demo\/)/.test(text), text);
    assert.match(demoView(accounts).session.id, /^0{8}-0{4}-4000-8000-0{12}$/);
  });
});
