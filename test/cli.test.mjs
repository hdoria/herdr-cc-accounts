import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
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
import { fileURLToPath, pathToFileURL } from "node:url";

const MOD = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "cc-accounts");
const BIN = join(MOD, "cc-accounts");
const CLI = pathToFileURL(join(MOD, "cli.js")).href;
const cli = await import(CLI);
const { nameProblem } = await import(pathToFileURL(join(MOD, "model.js")).href);
const lsAccounts = (text) => JSON.parse(text).accounts;

const DIRECTORIES = [
  "agents",
  "backups",
  "cache",
  "chrome",
  "file-history",
  "hooks",
  "paste-cache",
  "plans",
  "plugins",
  "projects",
  "session-env",
  "sessions",
  "shell-snapshots",
  "skills",
  "state",
  "tasks",
  "teams",
  "telemetry",
];
const FILES = [".last-cleanup", "CLAUDE.md", "history.jsonl", "mcp-needs-auth-cache.json", "settings.json"];
const PRIVATE = [
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
  ".last-cleanup",
  "daemon.json",
];

const FAKE_STATE = {
  numStartups: 99,
  oauthAccount: { emailAddress: "main@example.com" },
  mcpServers: {
    github: { type: "stdio", command: "gh-mcp", args: ["--x"] },
    docs: { type: "http", url: "https://example.com/mcp" },
  },
  projects: {
    "/work/a": {
      mcpServers: { local: { command: "x" } },
      allowedTools: ["Bash(ls)"],
      hasTrustDialogAccepted: true,
      enabledMcpjsonServers: ["s1"],
      disabledMcpjsonServers: ["s2"],
      lastCost: 12.5,
      history: ["project secret"],
    },
    "/work/no-slice": { lastCost: 1 },
  },
};

let root;
let counter = 0;
let stubBin;

// A stand-in for macOS `security`, first on every CLI test's PATH so the real Keychain is never asked.
// CC_STUB_KEYCHAIN names a file with one service per line: those exist, everything else exits 44.
// CC_STUB_LOG, when set, receives every argument list.
const SECURITY_STUB = `#!/bin/sh
[ -n "$CC_STUB_LOG" ] && printf '%s\\n' "$*" >> "$CC_STUB_LOG"
service=""
while [ $# -gt 0 ]; do
  [ "$1" = "-s" ] && service="$2"
  shift
done
[ -n "$CC_STUB_KEYCHAIN" ] && grep -qxF -- "$service" "$CC_STUB_KEYCHAIN" && exit 0
exit 44
`;

function newHome({ state = FAKE_STATE, extras = [] } = {}) {
  const home = join(root, `h${counter++}`);
  const claude = join(home, ".claude");
  mkdirSync(claude, { recursive: true });
  for (const d of DIRECTORIES) mkdirSync(join(claude, d), { recursive: true });
  for (const f of [...FILES, ...extras]) writeFileSync(join(claude, f), `content of ${f}\n`);
  writeFileSync(join(claude, "skills", "a-skill.md"), "skill\n");
  if (state) writeFileSync(join(home, ".claude.json"), JSON.stringify(state, null, 2));
  return home;
}

function cc(home, args, { env = {} } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: { HOME: home, PATH: `${stubBin}:${process.env.PATH}`, ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function tree(path, prefix = "") {
  const map = {};
  for (const name of readdirSync(path).sort()) {
    const full = join(path, name);
    const key = `${prefix}${name}`;
    const st = lstatSync(full);
    if (st.isSymbolicLink()) map[key] = `L:${readlinkSync(full)}`;
    else if (st.isDirectory()) {
      map[key] = "D";
      Object.assign(map, tree(full, `${key}/`));
    } else map[key] = `F:${createHash("sha256").update(readFileSync(full)).digest("hex")}`;
  }
  return map;
}

const sourceHash = (home) => ({
  claude: tree(join(home, ".claude")),
  state: createHash("sha256")
    .update(readFileSync(join(home, ".claude.json")))
    .digest("hex"),
});

const readState = (home, name) =>
  JSON.parse(readFileSync(join(home, ".claude-accounts", name, ".claude.json"), "utf8"));

function fakeClaude(home) {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const file = join(bin, "claude");
  writeFileSync(file, '#!/bin/sh\necho "cfg=${CLAUDE_CONFIG_DIR-EMPTY}"\necho "args=$*"\nexit "${FAKE_EXIT:-0}"\n');
  chmodSync(file, 0o755);
  return `${bin}:${process.env.PATH}`;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "cc-accounts-test-"));
  stubBin = join(root, "stub-bin");
  mkdirSync(stubBin);
  writeFileSync(join(stubBin, "security"), SECURITY_STUB, { mode: 0o755 });
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("add and sync", () => {
  test("add then sync twice gives the same tree", () => {
    const home = newHome();
    const account = join(home, ".claude-accounts", "work");
    assert.equal(cc(home, ["add", "work"]).code, 0);
    const afterAdd = tree(account);
    const first = cc(home, ["sync", "work"]);
    const second = cc(home, ["sync", "work"]);
    assert.deepEqual(tree(account), afterAdd);
    assert.match(first.out, /nothing to change/);
    assert.match(second.out, /nothing to change/);
    assert.equal(cc(home, ["add", "work"]).code, 0);
    assert.deepEqual(tree(account), afterAdd);
  });

  test("links point to ~/.claude and only existing link and history entries become links", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const account = join(home, ".claude-accounts", "work");
    for (const name of [
      "agents",
      "hooks",
      "skills",
      "plugins",
      "CLAUDE.md",
      "settings.json",
      "projects",
      "plans",
      "file-history",
      "shell-snapshots",
      "history.jsonl",
    ]) {
      assert.equal(readlinkSync(join(account, name)), join(home, ".claude", name), name);
    }
    assert.equal(readFileSync(join(account, "skills", "a-skill.md"), "utf8"), "skill\n");
  });

  test("a history entry missing in ~/.claude is not created and is reported", () => {
    const home = newHome();
    const r = cc(home, ["add", "work"]);
    assert.throws(() => lstatSync(join(home, ".claude-accounts", "work", "todos")));
    assert.throws(() => lstatSync(join(home, ".claude", "todos")));
    assert.match(r.out, /missing in ~\/\.claude.*todos/);
  });

  test("nothing private becomes a link", () => {
    const home = newHome({ extras: [".credentials.json", ".claude.json", "daemon.json"] });
    mkdirSync(join(home, ".claude", "statsig"));
    mkdirSync(join(home, ".claude", "logs"));
    cc(home, ["add", "work"]);
    const account = join(home, ".claude-accounts", "work");
    const links = readdirSync(account).filter((name) => lstatSync(join(account, name)).isSymbolicLink());
    for (const name of PRIVATE) {
      const st = (() => {
        try {
          return lstatSync(join(account, name));
        } catch {
          return null;
        }
      })();
      assert.ok(!st?.isSymbolicLink(), `${name} became a link`);
    }
    for (const name of links) assert.ok(!PRIVATE.includes(name), `${name} is private`);
  });

  test("an entry of ~/.claude in no list is not linked and is reported as unclassified", () => {
    const home = newHome({ extras: ["something-new.json"] });
    const r = cc(home, ["add", "work"]);
    assert.throws(() => lstatSync(join(home, ".claude-accounts", "work", "something-new.json")));
    assert.match(r.out, /unclassified.*something-new\.json/);
  });

  test("the fake ~/.claude and ~/.claude.json stay byte-for-byte identical", () => {
    const home = newHome();
    const before = sourceHash(home);
    cc(home, ["add", "work"]);
    cc(home, ["add", "personal"]);
    cc(home, ["sync"]);
    cc(home, ["ls", "--json"]);
    assert.deepEqual(sourceHash(home), before);
  });

  test("invalid names are refused and nothing is created", () => {
    const home = newHome();
    for (const name of ["Work", "a b", "../x", "a_b", "default", "-work", ""]) {
      assert.notEqual(cc(home, ["add", name]).code, 0, `"${name}" should be refused`);
    }
    assert.throws(() => readdirSync(join(home, ".claude-accounts")));
  });

  test("the CLI refuses the names the add form refuses, with the same words", () => {
    const home = newHome();
    for (const name of ["Work", "a b", "../x", "default", "-work", "a_b"]) {
      const expected = nameProblem(name, { reserved: ["default"] });
      assert.ok(expected, name);
      assert.equal(cc(home, ["add", name]).err.trim(), `cc-accounts: ${expected}`);
    }
  });

  test("a name may start with a digit and contain hyphens", () => {
    const home = newHome();
    assert.equal(cc(home, ["add", "2-work"]).code, 0);
  });
});

describe("replicated state", () => {
  test("the replicated mcpServers equal the source", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    assert.deepEqual(readState(home, "work").mcpServers, FAKE_STATE.mcpServers);
  });

  test("only the sliced project keys are copied", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const account = readState(home, "work");
    assert.deepEqual(account.projects, {
      "/work/a": {
        mcpServers: { local: { command: "x" } },
        allowedTools: ["Bash(ls)"],
        hasTrustDialogAccepted: true,
        enabledMcpjsonServers: ["s1"],
        disabledMcpjsonServers: ["s2"],
      },
    });
    assert.equal(account.numStartups, undefined);
    assert.equal(account.oauthAccount, undefined);
  });

  test("keys that exist only in the account are preserved, and mcpServers is a union", () => {
    const home = newHome();
    const dir = join(home, ".claude-accounts", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({
        oauthAccount: { emailAddress: "work@example.com" },
        mcpServers: { only_here: { command: "y" } },
        projects: { "/work/a": { lastCost: 3, hasTrustDialogAccepted: true } },
      }),
    );
    cc(home, ["sync", "work"]);
    const account = readState(home, "work");
    assert.equal(account.oauthAccount.emailAddress, "work@example.com");
    assert.deepEqual(Object.keys(account.mcpServers).sort(), ["docs", "github", "only_here"]);
    assert.equal(account.projects["/work/a"].lastCost, 3);
    assert.deepEqual(account.projects["/work/a"].allowedTools, ["Bash(ls)"]);
  });

  test("allowedTools and the enabled and disabled server lists are a union, origin first, without duplicates", () => {
    const home = newHome({
      state: {
        projects: {
          "/work/a": {
            allowedTools: ["Bash(ls)", "Read"],
            enabledMcpjsonServers: ["s1"],
            disabledMcpjsonServers: ["s2"],
          },
        },
      },
    });
    const dir = join(home, ".claude-accounts", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({
        projects: {
          "/work/a": {
            allowedTools: ["Read", "Edit"],
            enabledMcpjsonServers: ["s3"],
            disabledMcpjsonServers: [],
          },
        },
      }),
    );
    assert.equal(cc(home, ["sync", "work"]).code, 0);
    const project = readState(home, "work").projects["/work/a"];
    assert.deepEqual(project.allowedTools, ["Bash(ls)", "Read", "Edit"]);
    assert.deepEqual(project.enabledMcpjsonServers, ["s1", "s3"]);
    assert.deepEqual(project.disabledMcpjsonServers, ["s2"]);
    assert.match(cc(home, ["sync", "work"]).out, /nothing to change/);
  });

  test("writes use mode 0600 and a stable file is not rewritten", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const file = join(home, ".claude-accounts", "work", ".claude.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const inode = statSync(file).ino;
    cc(home, ["sync", "work"]);
    assert.equal(statSync(file).ino, inode);
  });

  test("invalid JSON in the account aborts sync without writing anything", () => {
    const home = newHome();
    const dir = join(home, ".claude-accounts", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".claude.json"), "{ broken");
    const r = cc(home, ["sync", "work"]);
    assert.notEqual(r.code, 0);
    assert.equal(readFileSync(join(dir, ".claude.json"), "utf8"), "{ broken");
    assert.deepEqual(readdirSync(dir), [".claude.json"]);
  });

  test("temporary files leave nothing behind, even with concurrent syncs", async () => {
    const home = newHome();
    mkdirSync(join(home, ".claude-accounts", "work"), { recursive: true });
    const runs = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise((resolve) => {
            const child = spawn(process.execPath, [BIN, "sync", "work"], {
              env: { HOME: home, PATH: process.env.PATH },
            });
            let err = "";
            child.stderr.on("data", (d) => {
              err += d;
            });
            child.on("exit", (code) => resolve({ code, err }));
          }),
      ),
    );
    for (const r of runs) {
      assert.equal(r.code, 0, r.err);
      assert.equal(r.err, "");
    }
    const dir = join(home, ".claude-accounts", "work");
    assert.ok(readdirSync(dir).every((name) => !name.endsWith(".tmp")));
    assert.deepEqual(readState(home, "work").mcpServers, FAKE_STATE.mcpServers);
    assert.equal(readlinkSync(join(dir, "skills")), join(home, ".claude", "skills"));
  });

  function syncWithHook(home, hookSource) {
    const script = `
      import { writeFileSync } from "node:fs";
      const { syncState } = await import(${JSON.stringify(CLI)});
      const file = ${JSON.stringify(join(home, ".claude-accounts", "work", ".claude.json"))};
      let calls = 0;
      try {
        syncState(${JSON.stringify(join(home, ".claude-accounts", "work"))}, { beforeCommit() { calls++; ${hookSource} } });
        console.log("ok " + calls);
      } catch (e) { console.log("error " + e.message); }
    `;
    return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { HOME: home, PATH: process.env.PATH },
      encoding: "utf8",
    }).stdout.trim();
  }

  test("a change to the account file during the merge is merged again, not overwritten", () => {
    const home = newHome();
    const dir = join(home, ".claude-accounts", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".claude.json"), "{}");
    const out = syncWithHook(
      home,
      `if (calls === 1) writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: "late@example.com" } }));`,
    );
    assert.equal(out, "ok 2");
    const account = readState(home, "work");
    assert.equal(account.oauthAccount.emailAddress, "late@example.com");
    assert.deepEqual(account.mcpServers, FAKE_STATE.mcpServers);
  });

  test("a file that keeps changing is left to the other writer and reported", () => {
    const home = newHome();
    const dir = join(home, ".claude-accounts", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".claude.json"), "{}");
    const out = syncWithHook(home, `writeFileSync(file, JSON.stringify({ n: calls }));`);
    assert.match(out, /^error .*kept changing/);
    assert.deepEqual(readState(home, "work"), { n: 2 });
  });
});

describe("shared settings warnings", () => {
  test("sync names the credential keys in the shared settings.json without printing values", () => {
    const home = newHome();
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        apiKeyHelper: "/bin/secret-helper-xyz",
        env: { ANTHROPIC_API_KEY: "sk-secret-111", ANTHROPIC_AUTH_TOKEN: "tok-secret-222", OTHER: "fine" },
      }),
    );
    cc(home, ["add", "work"]);
    const r = cc(home, ["sync"]);
    assert.match(
      r.out,
      /warning: shared settings\.json sets apiKeyHelper, env\.ANTHROPIC_API_KEY, env\.ANTHROPIC_AUTH_TOKEN/,
    );
    assert.doesNotMatch(r.out + r.err, /secret/);
  });

  test("no warning when the settings carry none of those keys", () => {
    const home = newHome();
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "x", env: { OTHER: "1" } }));
    cc(home, ["add", "work"]);
    assert.doesNotMatch(cc(home, ["sync"]).out, /shared settings/);
  });
});

describe("link repair", () => {
  test("a link replaced by a file is repaired and the file is kept as .divergent-*", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const account = join(home, ".claude-accounts", "work");
    rmSync(join(account, "settings.json"));
    writeFileSync(join(account, "settings.json"), '{"model":"other"}\n');
    const r = cc(home, ["sync", "work"]);
    assert.equal(readlinkSync(join(account, "settings.json")), join(home, ".claude", "settings.json"));
    const kept = readdirSync(account).filter((name) => name.startsWith("settings.json.divergent-"));
    assert.equal(kept.length, 1);
    assert.equal(readFileSync(join(account, kept[0]), "utf8"), '{"model":"other"}\n');
    assert.match(r.out, /repaired: settings\.json.*settings\.json\.divergent-/);
    assert.match(cc(home, ["sync", "work"]).out, /nothing to change/);
  });

  test("a regular folder in place of a link is kept too, nothing is deleted", () => {
    const home = newHome();
    const dir = join(home, ".claude-accounts", "work");
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, "projects", "session.jsonl"), "data\n");
    cc(home, ["sync", "work"]);
    assert.equal(readlinkSync(join(dir, "projects")), join(home, ".claude", "projects"));
    const kept = readdirSync(dir).find((name) => name.startsWith("projects.divergent-"));
    assert.equal(readFileSync(join(dir, kept, "session.jsonl"), "utf8"), "data\n");
  });

  test("parallel syncs repairing the same entries lose no replaced content and keep no stray link as divergent", async () => {
    const names = ["settings.json", "CLAUDE.md", "history.jsonl", "keybindings.json"];
    const runSync = (home) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [BIN, "sync", "work"], {
          env: { HOME: home, PATH: process.env.PATH },
          stdio: "ignore",
        });
        child.on("exit", resolve);
      });
    for (let round = 0; round < 30; round++) {
      const home = newHome({ extras: ["keybindings.json"] });
      cc(home, ["add", "work"]);
      const account = join(home, ".claude-accounts", "work");
      const replaced = new Map();
      for (const name of names) {
        rmSync(join(account, name));
        const content = `round ${round} ${name} unique content\n`;
        writeFileSync(join(account, name), content);
        replaced.set(name, content);
      }
      await Promise.all(Array.from({ length: 8 }, () => runSync(home)));
      const kept = readdirSync(account).filter((name) => name.includes(".divergent-"));
      for (const name of kept) {
        assert.equal(lstatSync(join(account, name)).isSymbolicLink(), false, `round ${round}: ${name} is only a link`);
      }
      for (const [name, content] of replaced) {
        const survivors = kept
          .filter((k) => k.startsWith(`${name}.divergent-`))
          .map((k) => readFileSync(join(account, k), "utf8"));
        assert.deepEqual(survivors, [content], `round ${round}: content of ${name} was lost or duplicated`);
        assert.equal(readlinkSync(join(account, name)), join(home, ".claude", name));
      }
    }
  });

  test("concurrent runs on a fresh account never print a stack trace", async () => {
    for (let round = 0; round < 3; round++) {
      const home = newHome();
      mkdirSync(join(home, ".claude-accounts", "work"), { recursive: true });
      const runs = await Promise.all(
        Array.from(
          { length: 10 },
          () =>
            new Promise((resolve) => {
              const child = spawn(process.execPath, [BIN, "sync", "work"], {
                env: { HOME: home, PATH: process.env.PATH },
              });
              let err = "";
              child.stderr.on("data", (d) => {
                err += d;
              });
              child.on("exit", (code) => resolve({ code, err }));
            }),
        ),
      );
      for (const r of runs) {
        assert.equal(r.code, 0, r.err);
        assert.doesNotMatch(r.err, /EEXIST|ENOENT|\bat \w/);
      }
      const account = join(home, ".claude-accounts", "work");
      assert.ok(readdirSync(account).every((name) => !name.includes(".divergent-")));
      assert.equal(readlinkSync(join(account, "agents")), join(home, ".claude", "agents"));
    }
  });
});

describe("unsafe account folders", () => {
  test("a missing root that would be created inside ~/.claude is refused before anything is created", () => {
    const home = newHome();
    rmSync(join(home, ".claude"), { recursive: true });
    symlinkSync(home, join(home, ".claude"));
    const r = cc(home, ["add", "work"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /would be created inside ~\/\.claude/);
    assert.ok(!existsSync(join(home, ".claude-accounts")));
  });

  test("a missing root next to an unrelated ~/.claude is created normally", () => {
    const home = newHome();
    assert.equal(cc(home, ["add", "work"]).code, 0);
    assert.ok(existsSync(join(home, ".claude-accounts", "work")));
  });

  for (const name of [".claude.json", ".credentials.json"]) {
    test(`a symbolic link at ${name} makes sync refuse and nothing is written through it`, () => {
      const home = newHome();
      const dir = join(home, ".claude-accounts", "work");
      mkdirSync(dir, { recursive: true });
      const outside = join(home, "outside.json");
      writeFileSync(outside, '{"untouched":true}\n');
      symlinkSync(outside, join(dir, name));
      const r = cc(home, ["sync", "work"]);
      assert.notEqual(r.code, 0);
      assert.match(r.err, new RegExp(`${name.replace(".", "\\.")} is a symbolic link`));
      assert.equal(readFileSync(outside, "utf8"), '{"untouched":true}\n');
      assert.equal(lstatSync(join(dir, name)).isSymbolicLink(), true);
    });

    test(`run only warns about a symbolic link at ${name} and still opens claude`, () => {
      const home = newHome();
      const dir = join(home, ".claude-accounts", "work");
      mkdirSync(dir, { recursive: true });
      const outside = join(home, "outside.json");
      writeFileSync(outside, '{"untouched":true}\n');
      symlinkSync(outside, join(dir, name));
      const r = cc(home, ["run", "work"], { env: { PATH: fakeClaude(home) } });
      assert.equal(r.code, 0);
      assert.match(r.err, /warning: .*symbolic link/);
      assert.match(r.out, /cfg=/);
      assert.equal(readFileSync(outside, "utf8"), '{"untouched":true}\n');
    });
  }
});

describe("ls", () => {
  test("lists the default account and the accounts with email and folder", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    cc(home, ["add", "personal"]);
    writeFileSync(
      join(home, ".claude-accounts", "personal", ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "me@example.com" } }),
    );
    const list = lsAccounts(cc(home, ["ls", "--json"]).out);
    assert.deepEqual(list, [
      { name: "default", dir: null, email: "main@example.com", signedIn: false },
      { name: "personal", dir: join(home, ".claude-accounts", "personal"), email: "me@example.com", signedIn: false },
      { name: "work", dir: join(home, ".claude-accounts", "work"), email: null, signedIn: false },
    ]);
    assert.match(cc(home, ["ls"]).out, /personal\s+me@example\.com\s+not signed in/);
  });
});

const service = (dir) =>
  dir === null
    ? "Claude Code-credentials"
    : `Claude Code-credentials-${createHash("sha256").update(dir.normalize("NFC")).digest("hex").slice(0, 8)}`;

describe("demo", () => {
  const DEMO_NAMES = ["personal", "client", "work"];

  test("on lists sample accounts, off brings the real ones back, and nothing real is touched or asked", () => {
    const home = newHome();
    cc(home, ["add", "real-account"]);
    const before = sourceHash(home);
    const log = join(home, "security.log");
    const env = { CC_STUB_LOG: log };

    const on = cc(home, ["demo", "on"], { env });
    assert.equal(on.code, 0, on.err);
    assert.ok(lstatSync(join(home, ".claude-accounts", ".demo")).isFile());

    const listing = JSON.parse(cc(home, ["ls", "--json"], { env }).out);
    assert.equal(listing.demo, true);
    assert.deepEqual(
      listing.accounts.map((a) => a.name),
      DEMO_NAMES,
    );
    assert.deepEqual(
      listing.accounts.map((a) => a.signedIn),
      [true, false, true],
    );
    assert.ok(listing.accounts.every((a) => a.email.endsWith("@example.com")));
    assert.equal(listing.accounts[0].dir, null);
    assert.ok(!JSON.stringify(listing).includes(home), "no path of the machine in the sample data");
    assert.match(cc(home, ["ls"], { env }).out, /^demo mode: .*\npersonal\s+personal@example\.com\s+signed in/);
    assert.equal(existsSync(log), false, "the Keychain is not asked in demo mode");

    assert.equal(cc(home, ["demo", "on"]).code, 0, "a second `on` changes nothing");
    assert.equal(cc(home, ["demo", "off"]).code, 0);
    assert.equal(existsSync(join(home, ".claude-accounts", ".demo")), false);
    const real = JSON.parse(cc(home, ["ls", "--json"]).out);
    assert.equal(real.demo, false);
    assert.deepEqual(
      real.accounts.map((a) => a.name),
      ["default", "real-account"],
    );
    assert.deepEqual(sourceHash(home), before);
    assert.equal(cc(home, ["demo", "off"]).code, 0, "`off` with no flag is fine");
  });

  test("on creates the accounts folder when it does not exist yet, and writes only the flag there", () => {
    const home = newHome();
    assert.equal(cc(home, ["demo", "on"]).code, 0);
    assert.deepEqual(readdirSync(join(home, ".claude-accounts")), [".demo"]);
  });

  test("anything but one of on or off is a usage error", () => {
    const home = newHome();
    for (const args of [["demo"], ["demo", "maybe"], ["demo", "on", "off"]]) {
      const r = cc(home, args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.err, /usage: cc-accounts demo on\|off/);
    }
    assert.equal(existsSync(join(home, ".claude-accounts")), false);
  });

  test("the demo flag does not make an account of its own", () => {
    const home = newHome();
    cc(home, ["demo", "on"]);
    cc(home, ["demo", "off"]);
    cc(home, ["add", "work"]);
    assert.deepEqual(
      lsAccounts(cc(home, ["ls", "--json"]).out).map((a) => a.name),
      ["default", "work"],
    );
  });
});

describe("signedIn", () => {
  const viaKeychain = { skip: process.platform !== "darwin" && "the Keychain is macOS only" };
  const keychain = (...services) => {
    const file = join(root, `keychain${counter++}`);
    writeFileSync(file, `${services.join("\n")}\n`);
    return file;
  };

  test("a Keychain item per account decides it, and only the exit code of a plain lookup is used", viaKeychain, () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    cc(home, ["add", "personal"]);
    const work = join(home, ".claude-accounts", "work");
    const log = join(root, `log${counter++}`);
    const env = { USER: "tester", CC_STUB_LOG: log, CC_STUB_KEYCHAIN: keychain(service(null), service(work)) };
    const list = lsAccounts(cc(home, ["ls", "--json"], { env }).out);
    assert.deepEqual(
      list.map((a) => [a.name, a.signedIn]),
      [
        ["default", true],
        ["personal", false],
        ["work", true],
      ],
    );
    const calls = readFileSync(log, "utf8").trim().split("\n");
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.match(call, /^find-generic-password -s Claude Code-credentials(-[0-9a-f]{8})? -a tester$/);
      assert.doesNotMatch(call, /(^| )-[wg]\b/);
    }
    assert.match(cc(home, ["ls"], { env }).out, /default\s+main@example\.com\s+signed in/);
  });

  test("the service name hashes the folder path in NFC, even when the path on disk is NFD", viaKeychain, () => {
    const home = join(root, `h${counter++}-cafe\u0301`);
    mkdirSync(join(home, ".claude"), { recursive: true });
    cc(home, ["add", "work"]);
    const dir = join(home, ".claude-accounts", "work");
    assert.notEqual(dir, dir.normalize("NFC"));
    const env = { USER: "tester", CC_STUB_KEYCHAIN: keychain(service(dir.normalize("NFC"))) };
    assert.equal(lsAccounts(cc(home, ["ls", "--json"], { env }).out).find((a) => a.name === "work").signedIn, true);
    const raw = `Claude Code-credentials-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}`;
    const other = { USER: "tester", CC_STUB_KEYCHAIN: keychain(raw) };
    assert.equal(
      lsAccounts(cc(home, ["ls", "--json"], { env: other }).out).find((a) => a.name === "work").signedIn,
      false,
    );
  });

  test("the item of another user name does not count", viaKeychain, () => {
    const home = newHome();
    const log = join(root, `log${counter++}`);
    cc(home, ["ls", "--json"], { env: { USER: "somebody", CC_STUB_LOG: log, CC_STUB_KEYCHAIN: keychain() } });
    assert.match(readFileSync(log, "utf8"), /-a somebody\n$/);
  });

  test("a user name Claude would not accept becomes claude-code-user, as in the binary", viaKeychain, () => {
    const home = newHome();
    for (const [user, expected] of [
      ["tester.x_y-1", "tester.x_y-1"],
      ["john doe", "claude-code-user"],
      ["a;b", "claude-code-user"],
      ["josé", "claude-code-user"],
    ]) {
      const log = join(root, `log${counter++}`);
      cc(home, ["ls", "--json"], { env: { USER: user, CC_STUB_LOG: log, CC_STUB_KEYCHAIN: keychain() } });
      assert.match(readFileSync(log, "utf8"), new RegExp(`-a ${expected}\\n$`), user);
    }
    assert.equal(cli.keychainUser({ USER: "bad name" }), "claude-code-user");
    assert.equal(cli.keychainUser({ USER: "good" }), "good");
  });

  test("CLAUDE_SECURESTORAGE_CONFIG_DIR takes the place of the folder in the service name", viaKeychain, () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const override = "/somewhere/else";
    const log = join(root, `log${counter++}`);
    const env = {
      USER: "tester",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: override,
      CC_STUB_LOG: log,
      CC_STUB_KEYCHAIN: keychain(service(override)),
    };
    const list = lsAccounts(cc(home, ["ls", "--json"], { env }).out);
    assert.deepEqual(
      list.map((a) => a.signedIn),
      [true, true],
    );
    for (const call of readFileSync(log, "utf8").trim().split("\n")) assert.ok(call.includes(service(override)), call);
    assert.equal(cli.keychainService("/a/b", {}), service("/a/b"));
    assert.equal(cli.keychainService(null, {}), "Claude Code-credentials");
    assert.equal(cli.keychainService("/a/b", { CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }), service("/a/b"));
  });

  test("on macOS a .credentials.json in the folder counts as a login too, with no Keychain item", viaKeychain, () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    writeFileSync(join(home, ".claude-accounts", "work", ".credentials.json"), "{}");
    const list = lsAccounts(cc(home, ["ls", "--json"], { env: { USER: "tester", CC_STUB_KEYCHAIN: keychain() } }).out);
    assert.deepEqual(
      list.map((a) => [a.name, a.signedIn]),
      [
        ["default", false],
        ["work", true],
      ],
    );
  });

  test(
    "off macOS the login is the .credentials.json file of the folder",
    { skip: process.platform === "darwin" && "macOS uses the Keychain" },
    () => {
      const home = newHome();
      cc(home, ["add", "work"]);
      writeFileSync(join(home, ".claude", ".credentials.json"), "{}");
      const list = lsAccounts(cc(home, ["ls", "--json"]).out);
      assert.deepEqual(
        list.map((a) => [a.name, a.signedIn]),
        [
          ["default", true],
          ["work", false],
        ],
      );
    },
  );
});

describe("default account name", () => {
  function withDefaultName(content) {
    const home = newHome();
    mkdirSync(join(home, ".claude-accounts"), { recursive: true });
    writeFileSync(join(home, ".claude-accounts", ".default-name"), content);
    return home;
  }

  test("a valid .default-name renames the implicit account in ls, run and add", () => {
    const home = withDefaultName("main\n");
    cc(home, ["add", "work"]);
    assert.deepEqual(
      lsAccounts(cc(home, ["ls", "--json"]).out).map((a) => a.name),
      ["main", "work"],
    );
    const r = cc(home, ["run", "main"], { env: { PATH: fakeClaude(home), CLAUDE_CONFIG_DIR: "/anything" } });
    assert.match(r.out, /cfg=EMPTY/);
    assert.equal(cc(home, ["run", "default"], { env: { PATH: fakeClaude(home) } }).code, 0);
    assert.notEqual(cc(home, ["add", "main"]).code, 0);
    assert.notEqual(cc(home, ["sync", "main"]).code, 0);
  });

  test("a missing file means default", () => {
    const home = newHome();
    assert.equal(lsAccounts(cc(home, ["ls", "--json"]).out)[0].name, "default");
  });

  test("an invalid name falls back to default", () => {
    for (const content of ["Main\n", "two\nlines\n", "a b", "", "-x", "../x"]) {
      const home = withDefaultName(content);
      assert.equal(lsAccounts(cc(home, ["ls", "--json"]).out)[0].name, "default", JSON.stringify(content));
    }
  });

  test("a name that collides with an existing account folder falls back to default", () => {
    const home = withDefaultName("work\n");
    mkdirSync(join(home, ".claude-accounts", "work"));
    assert.deepEqual(
      lsAccounts(cc(home, ["ls", "--json"]).out).map((a) => a.name),
      ["default", "work"],
    );
  });
});

describe("unsafe accounts root", () => {
  test("a symbolic link as ~/.claude-accounts is refused by every command", () => {
    const home = newHome();
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(home, ".claude-accounts"));
    for (const args of [["ls"], ["add", "work"], ["sync"], ["run", "default"], ["which", "1"]]) {
      const r = cc(home, args, { env: { PATH: fakeClaude(home) } });
      assert.notEqual(r.code, 0, args.join(" "));
      assert.match(r.err, /symbolic link/, args.join(" "));
    }
    assert.deepEqual(readdirSync(elsewhere), []);
  });

  test("a ~/.claude that is really the home folder makes the root overlap and is refused", () => {
    const home = newHome({ state: FAKE_STATE });
    rmSync(join(home, ".claude"), { recursive: true });
    symlinkSync(home, join(home, ".claude"));
    mkdirSync(join(home, ".claude-accounts"));
    const r = cc(home, ["add", "work"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /overlap/);
    assert.deepEqual(readdirSync(join(home, ".claude-accounts")), []);
  });

  test("a ~/.claude that really lives inside the root is refused", () => {
    const home = newHome();
    const real = join(home, ".claude-accounts", "inner");
    mkdirSync(join(home, ".claude-accounts"));
    rmSync(join(home, ".claude"), { recursive: true });
    mkdirSync(real);
    symlinkSync(real, join(home, ".claude"));
    const r = cc(home, ["sync"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /overlap/);
  });

  test("help still works", () => {
    const home = newHome();
    symlinkSync(home, join(home, ".claude-accounts"));
    assert.equal(cc(home, ["--help"]).code, 0);
  });
});

describe("run", () => {
  test("a named account runs with CLAUDE_CONFIG_DIR and relays args and the exit code", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const r = cc(home, ["run", "work", "--resume", "abc"], { env: { PATH: fakeClaude(home), FAKE_EXIT: "7" } });
    assert.equal(r.code, 7);
    assert.match(r.out, new RegExp(`cfg=${join(home, ".claude-accounts", "work")}\\n`));
    assert.match(r.out, /args=--resume abc/);
  });

  test("the default account removes CLAUDE_CONFIG_DIR from the environment", () => {
    const home = newHome();
    const r = cc(home, ["run", "default"], { env: { PATH: fakeClaude(home), CLAUDE_CONFIG_DIR: "/anything" } });
    assert.equal(r.code, 0);
    assert.match(r.out, /cfg=EMPTY/);
  });

  test("run syncs before opening and reports the repair", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const account = join(home, ".claude-accounts", "work");
    rmSync(join(account, "CLAUDE.md"));
    writeFileSync(join(account, "CLAUDE.md"), "replaced\n");
    const r = cc(home, ["run", "work"], { env: { PATH: fakeClaude(home) } });
    assert.equal(readlinkSync(join(account, "CLAUDE.md")), join(home, ".claude", "CLAUDE.md"));
    assert.match(r.err, /repaired: CLAUDE\.md/);
  });

  test("a missing account fails without opening claude", () => {
    const home = newHome();
    const r = cc(home, ["run", "does-not-exist"], { env: { PATH: fakeClaude(home) } });
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /cfg=/);
  });

  test("an invalid ~/.claude.json is a warning: claude still opens and links are applied", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    writeFileSync(join(home, ".claude.json"), "{ broken");
    const account = join(home, ".claude-accounts", "work");
    rmSync(join(account, "agents"));
    const r = cc(home, ["run", "work"], { env: { PATH: fakeClaude(home) } });
    assert.equal(r.code, 0);
    assert.match(r.out, /cfg=/);
    assert.match(r.err, /warning: ~\/\.claude\.json is not valid JSON/);
    assert.equal(readlinkSync(join(account, "agents")), join(home, ".claude", "agents"));
    assert.notEqual(cc(home, ["sync", "work"]).code, 0);
  });

  test("an invalid account .claude.json is a warning for run and an abort for sync", () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    writeFileSync(join(home, ".claude-accounts", "work", ".claude.json"), "{ broken");
    const r = cc(home, ["run", "work"], { env: { PATH: fakeClaude(home) } });
    assert.equal(r.code, 0);
    assert.match(r.err, /warning: .*\.claude\.json is not valid JSON/);
    assert.notEqual(cc(home, ["sync", "work"]).code, 0);
  });

  test("a sync that cannot write becomes a warning and claude still opens", { skip: process.getuid?.() === 0 }, () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const account = join(home, ".claude-accounts", "work");
    rmSync(join(account, "agents"));
    chmodSync(account, 0o500);
    try {
      const r = cc(home, ["run", "work"], { env: { PATH: fakeClaude(home) } });
      assert.equal(r.code, 0);
      assert.match(r.out, /cfg=/);
      assert.match(r.err, /warning: sync failed/);
      assert.doesNotMatch(r.err, /\bat \w+.*\(/);
    } finally {
      chmodSync(account, 0o700);
    }
  });
});

describe("which", () => {
  const alive = [];
  after(() => alive.forEach((child) => child.kill()));

  // `env -i` gives the process exactly this environment. A node child would otherwise be handed
  // NODE_V8_COVERAGE by the parent when the suite runs under coverage.
  async function process_(env, extraArgs = []) {
    const assignments = Object.entries(env).map(([key, value]) => `${key}=${value}`);
    const child = spawn(
      "/usr/bin/env",
      ["-i", ...assignments, process.execPath, "-e", "setTimeout(() => {}, 60000)", "--", ...extraArgs],
      { stdio: "ignore" },
    );
    alive.push(child);
    for (let i = 0; i < 100; i++) {
      const r = spawnSync("ps", ["-ww", "-o", "command=", "-p", String(child.pid)], { encoding: "utf8" });
      if (r.stdout.includes("setTimeout")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return child;
  }

  // One pid answers "<pid> <account>"; most tests care only about the account.
  const which = (home, pid) => {
    const r = cc(home, ["which", String(pid)]);
    return { ...r, out: r.out.replace(new RegExp(`^${pid} `), "") };
  };

  test("resolves the account from the process CLAUDE_CONFIG_DIR", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const child = await process_({
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude-accounts", "work"),
    });
    assert.equal(which(home, child.pid).out.trim(), "work");
  });

  test("resolves a CLAUDE_CONFIG_DIR given through a symbolic link or a trailing slash", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    symlinkSync(join(home, ".claude-accounts", "work"), join(home, "alias"));
    for (const value of [join(home, "alias"), `${join(home, ".claude-accounts", "work")}/`]) {
      const child = await process_({ PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: value });
      assert.equal(which(home, child.pid).out.trim(), "work", value);
    }
  });

  test("without CLAUDE_CONFIG_DIR, or pointing at ~/.claude, the account is the default one", async () => {
    const home = newHome();
    const none = await process_({ PATH: process.env.PATH, HOME: home });
    const explicit = await process_({ PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    assert.equal(which(home, none.pid).out.trim(), "default");
    assert.equal(which(home, explicit.pid).out.trim(), "default");
  });

  test("the default account shows its configured name", async () => {
    const home = newHome();
    mkdirSync(join(home, ".claude-accounts"));
    writeFileSync(join(home, ".claude-accounts", ".default-name"), "main\n");
    const child = await process_({ PATH: process.env.PATH, HOME: home });
    assert.equal(which(home, child.pid).out.trim(), "main");
  });

  test("a directory that is not a known account is unknown", async () => {
    const home = newHome();
    mkdirSync(join(home, "stranger"));
    const child = await process_({ PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, "stranger") });
    assert.equal(which(home, child.pid).out.trim(), "unknown");
  });

  test("when the environment cannot be read the answer is unknown, never default", async () => {
    const home = newHome();
    const child = await process_({});
    assert.equal(which(home, child.pid).out.trim(), "unknown");
  });

  test("no text from the environment ever reaches the output", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const dir = join(home, ".claude-accounts", "work");
    const cases = [
      { "a-b": "SECRET", CLAUDE_CONFIG_DIR: dir, "x.y": "SECRET" },
      { CLAUDE_CONFIG_DIR: dir, "a-b": "SECRET", "x.y": "SECRET", "9z": "SECRET" },
      { "a-b": "SECRET", "x.y": "SECRET" },
      { CLAUDE_CONFIG_DIR: `${home}/missing q=SECRET`, "a-b": "SECRET" },
      { CLAUDE_CONFIG_DIR: `${dir}-SECRET`, "x.y": "SECRET" },
    ];
    for (const extra of cases) {
      const child = await process_({ PATH: process.env.PATH, HOME: home, ...extra });
      const r = which(home, child.pid);
      assert.doesNotMatch(r.out + r.err, /SECRET/, JSON.stringify(Object.keys(extra)));
      assert.match(r.out.trim(), /^(work|default|unknown)$/);
    }
  });

  test("a name in the arguments is only trusted when argv[1] is this very script", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const child = await process_({ PATH: process.env.PATH, HOME: home }, ["/somewhere/cc-accounts", "run", "work"]);
    assert.equal(which(home, child.pid).out.trim(), "default");
  });

  test("the cc-accounts run wrapper and the claude it starts both resolve to the account", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const bin = join(home, "bin");
    mkdirSync(bin);
    const pidFile = join(home, "claude.pid");
    writeFileSync(
      join(bin, "claude"),
      `#!/bin/sh\necho $$ > "${pidFile}"\nexec "${process.execPath}" -e "setTimeout(() => {}, 60000)"\n`,
    );
    chmodSync(join(bin, "claude"), 0o755);
    const wrapper = spawn(process.execPath, [BIN, "run", "work"], {
      env: { HOME: home, PATH: `${bin}:${process.env.PATH}` },
      stdio: "ignore",
    });
    alive.push(wrapper);
    for (let i = 0; i < 150 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const claudePid = readFileSync(pidFile, "utf8").trim();
    for (let i = 0; i < 150; i++) {
      const r = spawnSync("ps", ["-ww", "-o", "command=", "-p", claudePid], { encoding: "utf8" });
      if (r.stdout.includes("setTimeout")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    try {
      assert.equal(which(home, wrapper.pid).out.trim(), "work");
      assert.equal(which(home, claudePid).out.trim(), "work");
    } finally {
      spawnSync("kill", [claudePid]);
    }
  });

  test("the wrapper is resolved when the script lives in a folder with spaces, also through a link", async () => {
    const home = newHome();
    const spaced = join(home, "dir with spaces", "my run bin");
    mkdirSync(spaced, { recursive: true });
    cpSync(BIN, join(spaced, "cc-accounts"));
    cpSync(join(MOD, "cli.js"), join(spaced, "cli.js"));
    cpSync(join(MOD, "model.js"), join(spaced, "model.js"));
    chmodSync(join(spaced, "cc-accounts"), 0o755);
    symlinkSync(join(spaced, "cc-accounts"), join(home, "linked cc-accounts"));
    const script = join(spaced, "cc-accounts");
    spawnSync(process.execPath, [script, "add", "work"], { env: { HOME: home, PATH: process.env.PATH } });
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" -e "setTimeout(() => {}, 60000)"\n`);
    chmodSync(join(bin, "claude"), 0o755);
    for (const launch of [script, join(home, "linked cc-accounts")]) {
      const wrapper = spawn(process.execPath, [launch, "run", "work"], {
        env: { HOME: home, PATH: `${bin}:${process.env.PATH}` },
        stdio: "ignore",
      });
      alive.push(wrapper);
      let answer = "";
      for (let i = 0; i < 150 && answer !== "work"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        answer = spawnSync(process.execPath, [script, "which", String(wrapper.pid)], {
          env: { HOME: home, PATH: process.env.PATH },
          encoding: "utf8",
        })
          .stdout.trim()
          .replace(/^\d+ /, "");
      }
      assert.equal(answer, "work", launch);
      wrapper.kill();
    }
  });

  test("more than one CLAUDE_CONFIG_DIR= in the environment is unknown", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    cc(home, ["add", "personal"]);
    const work = join(home, ".claude-accounts", "work");
    const personal = join(home, ".claude-accounts", "personal");
    const child = await process_({
      PATH: process.env.PATH,
      HOME: home,
      AAA: `SECRET CLAUDE_CONFIG_DIR=${personal}`,
      CLAUDE_CONFIG_DIR: work,
    });
    const r = which(home, child.pid);
    assert.equal(r.out.trim(), "unknown");
    assert.doesNotMatch(r.out + r.err, /SECRET/);
  });

  test("a value that swallows the next variable never leaks it", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const work = join(home, ".claude-accounts", "work");
    const child = await process_({ PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: `${work} Z=SECRET` });
    const r = which(home, child.pid);
    assert.doesNotMatch(r.out + r.err, /SECRET/);
    assert.match(r.out.trim(), /^(work|unknown)$/);
  });

  test("several pids answer in one call, one line each and in the order asked", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    cc(home, ["add", "personal"]);
    const dir = (name) => join(home, ".claude-accounts", name);
    const base = { PATH: process.env.PATH, HOME: home };
    const a = await process_({ ...base, CLAUDE_CONFIG_DIR: dir("work") });
    const b = await process_(base);
    const c = await process_({ ...base, CLAUDE_CONFIG_DIR: dir("personal") });
    const d = await process_({ ...base, CLAUDE_CONFIG_DIR: dir("work") });
    const r = cc(home, ["which", ...[c, a, b, d].map((x) => String(x.pid))]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `${c.pid} personal\n${a.pid} work\n${b.pid} default\n${d.pid} work\n`);
  });

  test("a pid that is gone among several prints unknown, keeps the others and exits 1", async () => {
    const home = newHome();
    cc(home, ["add", "work"]);
    const live = await process_({
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude-accounts", "work"),
    });
    const r = cc(home, ["which", "99998", String(live.pid)]);
    assert.equal(r.code, 1);
    assert.equal(r.out, `99998 unknown\n${live.pid} work\n`);
    assert.match(r.err, /99998 not running/);
  });

  test("which wants at least one numeric pid", () => {
    const home = newHome();
    for (const args of [["which"], ["which", "12", "x"], ["which", "1;2"]])
      assert.equal(cc(home, args).code, 2, args.join(" "));
  });

  test("a pid that does not exist exits with code 1", () => {
    const home = newHome();
    assert.equal(which(home, 99998).code, 1);
  });
});

describe("isRunWrapper", () => {
  test("a very long command line costs a fixed number of lookups, not one per pair of spaces", () => {
    const line = `node ${" run ".repeat(4000)}${" x".repeat(4000)}`;
    const started = Date.now();
    assert.equal(cli.isRunWrapper(line, BIN), false);
    assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
  });

  test("the script right after the interpreter is still recognized, with or without spaces in its path", () => {
    assert.equal(cli.isRunWrapper(`node ${BIN} run work`, BIN), true);
    assert.equal(cli.isRunWrapper(`node ${BIN} ls`, BIN), false);
    assert.equal(cli.isRunWrapper(`node --no-warnings ${BIN} run work --resume x`, BIN), true);
    assert.equal(cli.isRunWrapper("node /elsewhere/cc-accounts run work", BIN), false);
  });
});
