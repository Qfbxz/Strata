# Agents, hooks and memory files

The assistant can read four kinds of files you keep in folders. You create the files; Strata
picks them up on the next message — no restart. Everything here is opt-in: an empty folder
changes nothing. Every switch also lives in **Settings → Assistant → Assistant files**, saved in
the app settings.

## Agents — `agents/` folders

An agent is a persona with its own instructions. Put one `.md` file per agent into
`<data>/agents/` (or a workspace's `agents/` folder; the app folder wins a name clash):

```markdown
---
name: Petro Reviewer
description: Reviews drilling reports against the standard
tools: read, grep
---

Check every report against the standard. Refuse guesses.
```

The file name or the frontmatter `name` becomes the agent's id. `description` is what the
assistant sees when it decides who fits a task; the text under the frontmatter is what it
follows when it works as that agent. `tools` (optional) narrows what the agent may use; `model`
(optional) records a preference. Collections nest: `agents/<category>/<agent>/AGENT.md` works too
(folders holding an `AGENT.md` are agents; their other subfolders are files, not more agents).
Symlinked folders count.

- **In a chat**: just ask for the agent by name — the assistant reads the file and follows it.
- **Delegation**: when the assistant sends a helper, it can pass the agent's instructions as the
  helper's persona.

## Hooks — `hooks/<event>/` folders

A hook is one of your scripts run at a fixed point of a turn. Put scripts into
`<data>/hooks/<event>/`:

| Folder | When it runs |
| --- | --- |
| `pre-turn` | before the turn starts. The turn's details arrive as one JSON line on stdin. A nonzero exit **stops the turn**; the script's stderr is the reason you see. |
| `post-turn` | after the turn finished. Same payload; output is not shown. |

Scripts run in name order with a 30-second timeout. `session-start` exists as a name for future
use. Anything under the folder that is not a script is ignored. A failing script never crashes
the chat — the turn shows the reason and stops cleanly.

## Skills — `skills/` folders

Skills keep working as before: `<name>/SKILL.md` folders in the app's skills folder
or the workspace's. Folders from other agent tools (`~/.kimi-code/skills`, `~/.agents/skills`,
`~/.cc-switch/skills`) are also listed read-only, symlinks included, so what you already keep for
Claude or Codex shows up here without copying.

## Memory — what the assistant remembers

With the auto-memory feature on, the assistant keeps what it learns as markdown under its memory
folder and injects a short index of it into every session — so past decisions come back in later
work. **Settings → Assistant → Auto memory panel** shows the files it keeps (read-only; the
assistant is the only writer). Direct model chats read the same index, so the memory works there
too.

## Project instructions — `CLAUDE.md` / `AGENTS.md`

A `CLAUDE.md` or `AGENTS.md` in the working folder (or any folder above it) is read into the
chat as project instructions — the same convention Claude Code and other tools use. Both files
are read when both exist; `CLAUDE.md` comes first.

## Turning things off

**Settings → Assistant** carries one switch per surface (agents, hooks, memory, project
instructions, native skill packs, the branch chip in the composer). The switches are saved in the
app settings and read again on every message.
