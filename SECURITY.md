# Security

## What the mod runs and reads

`cc-accounts` runs on your computer, with your user's permissions, and does not use the network.

It runs these programs:

- Its own CLI, `mods/cc-accounts/cc-accounts` (Node), through Herdr's `exec`.
- `ps` (with `-E` to read one process's environment) and `pgrep -P`, to find which account a Claude process runs in.
- On macOS, `security find-generic-password -s <service> -a <user>`, to ask whether a login exists. Only the exit code is used. It is never run with `-w` or `-g`, so the secret is never requested, and nothing reads a token, a credential file or a Keychain value.
- On macOS, `security delete-generic-password -s <service> -a <user>`, only when you remove an account with `cc-accounts remove` (or the panel's trash icon). It deletes the Keychain item of that one account and nothing else, with its output ignored and never with `-w` or `-g`. If `CLAUDE_SECURESTORAGE_CONFIG_DIR` is set, the item is shared by every account and is not deleted.
- `claude`, only when you start it with `cc-accounts run <name>`.

It reads files outside its own folder:

- `~/.claude` (the list of entries and where links point) and `~/.claude.json`.
- `~/.claude-accounts/<name>/.claude.json`, for the e-mail it shows.
- `~/.claude*/sessions/<pid>.json`, for the id and folder of the focused pane's session.

It writes only under `~/.claude-accounts/` (links, each account's `.claude.json` with mode 0600, the optional `.demo` flag, and the deletion of an account's folder by `remove`, which never follows a link and never leaves the accounts folder), and, when you run `install.sh`, to `~/.local/bin/cc-accounts`, `~/.config/herdr-app/` and the layout file you choose. It never writes to `~/.claude` or `~/.claude.json`.

One thing travels: the `mcpServers` of `~/.claude.json` are copied into each account's `.claude.json`, and they can carry secrets in `env` or `headers`. Treat every account folder as holding the same MCP secrets as `~/.claude.json`.

The README's "What it reads and writes outside the repo" is the long form of this list.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for a security problem.

Include what you did, what you expected and what happened, and the versions of Herdr, Claude Code and Node. A report that shows a way to make the mod read a credential, write outside the places above or run something you did not ask for is the kind this policy is for.
