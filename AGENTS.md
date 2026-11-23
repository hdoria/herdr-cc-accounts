# AGENTS.md: herdr-cc-accounts

Instructions for any coding agent or person working in this repository. `CLAUDE.md` only imports this file.

## Rules for this stack

This is a Node.js tool written in JavaScript (ES modules, Node 22 or newer): a command line program, `cc-accounts`, and a mod for Herdr.app that draws on top of it. It is not a service, so the rules that are about servers (HTTP, a startup config check, `SIGTERM`, a JSON logger) do not apply. The rest of the Node rules do.

Read these before writing code. They allow no judgment call:

**Always:**

- Treat everything that comes from outside as unknown until it is checked: the JSON files of `~/.claude`, the output of `ps` and `security`, a pid, an account name. Parse it at the edge and trust the typed value after that.
- Put a timeout or a bound on everything that waits or searches. The CLI looks at a fixed number of positions in a command line and the mod reads on a timer, not in a loop.
- Make every command that writes idempotent: running `sync` twice changes nothing the second time.
- Write files through a temporary file and a rename, with the mode the file needs (0600 for an account's `.claude.json`).
- Use [Conventional Commits](#commits), also for a commit an agent makes.

**Never:**

- Commit a secret, a token, a `.env` with real values, a private key or real personal data. Examples and tests use `example.com` addresses and made-up names.
- Read, print, copy or log a credential. `security find-generic-password` is only ever run without `-w` and `-g`, and only its exit code is used.
- Write to `~/.claude` or `~/.claude.json`.
- Print text that came from `ps` or from a file the user can edit; answer with a known account name or `unknown`.
- Leave a floating promise or a `console.log` in the code. Output goes through `process.stdout.write` and `process.stderr.write`.
- Use a version range (`^`, `~`) in `package.json`: versions are exact and the lockfile is the source.
- Touch the real `HOME`, the real Keychain or the real `~/.config/herdr-app` in a test. Every test uses a temporary `HOME`.

## Architecture profile

**P1** (validation: a tool used by its author and by people who install it themselves, with no operational promise).

The profile sets how deep the proof goes. It does not allow skipping input validation, exposing a secret or logging personal data. P1 asks for: validated input, secrets outside the repository, no personal data in logs, and the mandatory checks (`commits`, `lint`, `test`).

## Code standards

In this order, with no step skipped:

1. **Profile**, above.
2. **Rules for this stack**, above.
3. **Where to put new code**:

   | New code                                        | Where                                                                            |
   | ----------------------------------------------- | -------------------------------------------------------------------------------- |
   | A command or a rule of the CLI                  | `mods/cc-accounts/cli.js`                                                        |
   | What the mod decides without touching Herdr     | `mods/cc-accounts/model.js` (pure functions, tested without Herdr)               |
   | What the mod draws or runs in Herdr             | `mods/cc-accounts/main.js` (only draws and calls; the decisions belong in model) |
   | The install, the key binding, the layout change | `install.sh`, `scripts/bind-key.mjs`, `scripts/place-layout.mjs`                 |
   | An API of Herdr the mod starts to use           | `types/herdr.d.ts`                                                               |
   | A test                                          | `test/<subject>.test.mjs`, next to the behavior it proves                        |

   Everything the gallery copies lives in `mods/cc-accounts/`, and the folder must work on its own: no import may leave it, and the CLI, `cc-accounts`, is inside it.

4. **Definition of Done**, below, before you conclude. Run the commands and paste their output. Do not claim that something compiles, passes or works without a run to show for it.
5. **A departure** is registered, never improvised in silence. In the pull request, in one sentence: what was chosen, what was given up, why. If it holds for the project, it also goes in "Registered divergences" at the end of this file.

Precedence: an explicit instruction from the user; then the registered divergences; then this file; then anything else, a model's habit included.

Never loosen a lint or type-check rule, disable a rule or add a suppression to make the build pass. If the lint stops you, the code changes.

### Tests

- Test behavior, not implementation: assert what a user of the CLI or of the mod can see.
- A rule of the CLI is tested by running the CLI, with a temporary `HOME` and a stand-in `security` first on the `PATH`.
- A rule of the mod is tested in `model.js` when it is pure, and in `test/mod-behavior.test.mjs` when it needs Herdr's calls. That test runs the mod's real source against recorded stand-ins.
- `c8` instruments the files Node loads, so `main.js` is not in the coverage figure: `test/mod-behavior.test.mjs` runs its source as text against stand-ins. Do not read the threshold as proof that the mod's drawing is tested.
- `herdr-app check mods/cc-accounts` is the proof that the mod loads in Herdr. Run it, with a throwaway `HOME`, after every change to the mod. `test/mod.test.mjs` does it when `herdr-app` is installed.

## Commits

Conventional Commits are required, `<type>(<scope>): <description>`. The `commit-msg` hook and the `commits` check reject what does not fit.

- The type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- The scope is optional and takes only lowercase letters, digits, `_`, `.` and `-`.
- The description is lowercase, in the imperative, with no final period. The header is at most 72 characters.
- The body, after a blank line, says what changed and why, never how, in lines of at most 100 characters.
- One logical change per commit. A breaking change has `!` after the scope and a note in the footer.

The `commits` check lints every commit of a pull request and of a push, not only the title. To fix one, reword it with `git rebase -i <base>` (or `git commit --amend` for the latest) and push with `--force-with-lease` to the pull request's branch, never to `main`.

## Working with agents

The shared plugins, `pstack` and `mattpocock-skills`, are declared in `.claude/settings.json`. After you trust the folder in Claude Code they show as enabled; install each once per clone with `claude plugin install pstack@pstack-claude --scope project` and `claude plugin install mattpocock-skills@claude-plugins-official --scope project`. An agent from another tool follows the same steps without the skills' names.

- **A bug with an unknown cause:** find the cause before the fix, and write the test that reproduces the bug, failing, before the fix.
- **A new rule:** test first.
- **A change that touches more than one module, or the design:** a plan before editing.
- **Before opening the pull request:** review your own diff and run the Definition of Done.

A skill guides; the CI is what enforces. No skill replaces a required check.

## Architecture decisions (ADR)

Read the ADRs in `docs/adr/` before you change an area, and do not propose again what one already rejected without saying why the reason changed. A decision that is hard to reverse, odd without context and a real choice becomes `docs/adr/NNNN-title.md` in the same pull request that implements it, and the pull request names it under "Changes". A departure from a rule goes in "Registered divergences".

## Commands

### Definition of Done (run before you conclude)

pnpm is the package manager, with its version and hash in `packageManager`. Install from the lockfile, without updating it: `pnpm install --frozen-lockfile`.

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run type-check
pnpm run test:coverage
pnpm run build
herdr-app check mods/cc-accounts
```

`herdr-app check` needs Herdr.app installed; run it with a throwaway `HOME` (`HOME=$(mktemp -d)`), because it writes under `HOME/Library/Application Support`.

### What the hook and the CI run (do not run it)

The hook (`lefthook.yml`) and the CI (`.github/workflows/ci.yml`) already run what follows. It is here so you know what blocks a commit or a pull request. Do not run the ones that format or write files.

```text
pnpm exec eslint --max-warnings 0 --fix
pnpm exec prettier --write
pnpm exec commitlint --edit
```

Required CI checks: `commits`, `lint` (format, lint, type-check) and `test` (coverage and build), which runs as `test (node 22)` and `test (node 24)`. The `test` job runs on `macos-latest` because the CLI reads a process environment with `ps -E`.

Install the hooks once per clone with `pnpm install`: the `prepare` script runs `lefthook install`.

## About the project

`cc-accounts` runs several Claude Code accounts at the same time on one machine. Each account is a folder with its own `CLAUDE_CONFIG_DIR` under `~/.claude-accounts/`, and the Herdr mod shows which account each pane uses. [`docs/adr/0001-one-claude-config-dir-per-account.md`](docs/adr/0001-one-claude-config-dir-per-account.md) records the decision behind it. The README explains what it does and how.

```text
mods/cc-accounts/   what the Herdr gallery copies: main.js, model.js, mod.json, icons/, RECIPE.md,
                    and the CLI (cc-accounts, the entry point, and cli.js)
keys.json           the key the mod expects, merged into the user's keys.json
install.sh          copies the mod folder, links the CLI, binds the key
scripts/            bind-key.mjs, place-layout.mjs and check-package.mjs (the build)
test/               node:test suites and their fixtures
types/              the declarations of the part of Herdr's API the mod uses
docs/adr/           architecture decisions
```

- The mod runs the CLI by its path inside the mod folder (`appHome()` plus `/mods/cc-accounts/cc-accounts`), with the `PATH` as the fallback. Keep the CLI in that folder.
- Demo mode (`cc-accounts demo on|off`) exists so the screenshot in `preview.png` shows no real data. Anything the mod draws must come from the demo data when `demo` is true.
- Herdr writes `jsconfig.json` and `gpui-kit.d.ts` into the mod's folder each time it loads the mod. Both stay out of Git, and `types/herdr.d.ts` is what the type check reads.
- Node: `.nvmrc` is 24, the version the CI runs. The code is meant to run on 22 and newer.

## Registered divergences (Divergências registradas)

Each is a rule this project does not follow, with the decision on record. A divergence with no entry here is a bug.

The review date, 2027-05-23, was chosen by the agent that set the project up (six months after the decision). It is not a date Hugo gave. The first four entries were decided by Hugo; the others are marked "to be confirmed by Hugo" until he confirms them.

- **TypeScript `strict`:** the code is JavaScript checked by `tsc --noEmit --checkJs` with JSDoc types, `strict` on. Reason: Herdr loads `main.js` as it is, with no build step, and the mod's API is declared for JavaScript. `tsconfig.mod.json` turns `strictNullChecks` off for the mod, as Herdr's own `jsconfig.json` does, because a view assigns its state in `init()`. Decided on 2026-11-23 by Hugo. Review on 2027-05-23.
- **`build` produces no artifact:** `pnpm run build` runs `scripts/check-package.mjs`, which checks that `mods/cc-accounts/` is self-contained (files, imports, the CLI's executable bit, icons, `RECIPE.md`). Reason: there is nothing to compile, and the folder the gallery copies is the artifact. Decided on 2026-11-23 by Hugo. Review on 2027-05-23.
- **`node:test` instead of Vitest, with c8 for the threshold:** the runner ships with Node, so the project has no test dependency at run time and none that reaches users. `c8` checks the 70% threshold on statements, branches, functions and lines, which the runner's own coverage flags do not cover for statements. Decided on 2026-11-23 by Hugo. Review on 2027-05-23.
- **Own CI workflow:** the standard's reusable workflows live in a private repository, which a public one cannot call. `.github/workflows/ci.yml` runs the same scripts under the same check names (`commits`, `lint`, `test`), with the `test` job on `macos-latest` and a matrix of Node 22 and 24, so its checks are named `test (node 22)` and `test (node 24)`. Decided on 2026-11-23 by Hugo. Review on 2027-05-23.
- **Lint scope:** ESLint uses `typescript-eslint`'s `recommended` set and the two typed rules `no-floating-promises` and `no-misused-promises` on the code that ships, instead of `recommendedTypeChecked`. Reason: in JavaScript with JSDoc, the `no-unsafe-*` rules fire on every `JSON.parse` and every Herdr call whose result the declarations leave open. The test files are left out of the typed rules because `node:test`'s `test()` and `describe()` return promises the runner settles. Recorded on 2026-11-23 by the agent that set up the project, to be confirmed by Hugo. Review on 2027-05-23.
- **The tests are not type-checked:** `tsc` reads the code that ships and the scripts, not `test/`. Reason: the tests stand in for Herdr's runtime with deliberately partial objects. They are linted and formatted like the rest. Recorded on 2026-11-23 by the agent that set up the project, to be confirmed by Hugo. Review on 2027-05-23.
- **No service layer:** the stack's rules on `createApp`, configuration validation at startup, a JSON logger, `problem+json` and `SIGTERM` do not apply, because this is a command and a mod. Recorded on 2026-11-23 by the agent that set up the project, to be confirmed by Hugo. Review on 2027-05-23.
- **Common sections rewritten in English:** the sections the standard shares between projects (rules for the stack, architecture profile, code standards, commits, commands) are written in English here, not copied in the standard's language. Reason: the repository is public and its readers and contributors may not read Portuguese. The title "Registered divergences (Divergências registradas)" keeps the standard's own name. Recorded on 2026-11-23 by the agent that set up the project, to be confirmed by Hugo. Review on 2027-05-23.
