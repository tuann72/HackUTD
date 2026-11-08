@AGENTS.md

# Claude Code notes

`AGENTS.md` (imported above) is the source of truth for every agent. Do not duplicate project rules here; add them to `AGENTS.md` so Codex and other tools see them too. Only put Claude Code–specific notes in this file.

- **Worktrees:** the default is one task per branch per worktree (see `AGENTS.md`, "Parallel work"). In Claude Code, start a session in its own worktree with `claude --worktree`, or use the worktree tool when you begin a task in an existing session.
- **Claiming work:** before editing, run `gh pr list --state open` and check the README's Active work table, then claim the task and open a draft PR as `AGENTS.md` describes.
