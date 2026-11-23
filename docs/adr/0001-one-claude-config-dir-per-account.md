# One CLAUDE_CONFIG_DIR per account

**Status:** accepted

Claude Code keeps one login per machine, so `/login` in one pane changes the account of every other pane and of every Claude started afterwards. We want several accounts at the same time, each pane in its own. Claude Code reads the folder it uses from `CLAUDE_CONFIG_DIR`, and on macOS it keeps the login in a Keychain item whose name carries a hash of that folder's path. So each account is a folder, `~/.claude-accounts/<name>/`, and the account of a process is the environment it was started in. The default account stays `~/.claude`, with the variable unset.

Three rules follow from that and hold for every change:

- **The Keychain item belongs to the folder.** Claude Code creates it and names it. We only ask whether it exists (`security find-generic-password` without `-w` or `-g`, exit code only) and never read, copy or move a token. The same goes for `.credentials.json`.
- **Nothing that is the user's is duplicated.** Skills, agents, commands, hooks, plugins, output styles, `CLAUDE.md`, `settings.json`, `keybindings.json` and the conversation history are symbolic links to `~/.claude`. Account state (`.claude.json`, `.credentials.json`, sessions, caches) is never linked. The one thing copied is the slice of `~/.claude.json` that makes an account usable at once: `mcpServers` and each project's trust and allowed tools, merged without overwriting what the account has.
- **The filesystem is the registry.** There is no config file that can drift from the folders.

## Alternatives we rejected

**Swapping the global credential, the way tools like clauth do.** A command puts a stored login into the one place Claude Code reads and the account changes for the whole machine. It is simple and needs no wrapper, but it is the problem we started with: only one account is live at a time, a pane started before the swap and one started after it fight over the login, and the tool has to read and write tokens, which makes it a custodian of secrets we would rather never touch.

**Copying the credential into each account's folder.** It would make an account usable without a login, but a refresh token copied twice is refreshed twice and one copy stops working, and a copied secret is a leak waiting for a backup or a sync tool.

**A config file listing accounts.** A second source of truth that drifts when someone deletes a folder by hand.

**Linking the whole of `~/.claude`.** The login, the sessions and the caches would be shared, which is the first problem again.

## Consequences

- A running process keeps its account. Switching means opening a new process, which is why the mod opens tabs and panes with `cc-accounts run <name>` instead of changing anything in place.
- Because Node cannot `exec`, `cc-accounts run` stays in front of `claude` as a wrapper. Telling which account a pane uses means reading the environment of the `claude` child (`ps -E`), so that part is macOS only and answers `unknown` elsewhere.
- If Claude Code changes how it names the Keychain item, accounts read "needs login" until the formula in `mods/cc-accounts/cli.js` is updated. The README lists this among the assumptions that were not checked against a real login.
- An MCP server or a permission revoked in `~/.claude.json` stays in the other accounts until it is revoked there too, because the merge is a union.
