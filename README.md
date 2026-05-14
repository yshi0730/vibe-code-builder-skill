# Vibe Code Builder Skill

One-shot builder that turns a natural-language requirement into:

1. A working dashboard (widget configs registered in `~/.claw/shared/shared.db`)
2. A persistent agent (full file bundle, ready for `talenthub agent publish`)
3. A workspace artifact bundle (sample HTML report, configs, exports)

## Architecture

```
Web entry (separate input box)
  ↓ user types: "我要一个客户跟进看板"
Vibe App Builder (one-shot, runs once per request)
  └─ this skill
       parse → compose widgets → fetch style → generate agent files → publish → auto-hire
  ↓ outputs
Generated Agent (per-app, persistent chat)
  ├─ vibe-customer-followup-x7k3/  (file bundle in ~/.openclaw/workspace-…/)
  ├─ Dashboard module registered (visible at device-xxx.clawln.app/m/…)
  └─ Workspace populated (sample report HTML + config)
  ↓
User chats with the new agent for iteration / data entry / exports
```

## Repo contents

| Path | Purpose |
|------|---------|
| `manifest.json` | Builder agent's own manifest (for the one-shot agent that owns this skill) |
| `IDENTITY.md`, `USER.md`, `SOUL.md` | Prompt files for the builder agent itself |
| `SKILL.md` | This skill's tools and pipeline |
| `src/` | Tool implementations |
| `templates/generated-agent/` | Templates the builder fills in to produce a generated agent's files |
| `CONFIG.md` | Configuration values (placeholders that need to be filled before first run) |
| `tests/` | Test cases for the skill tools |

## Status

🚧 Day 1 — scaffolding. First end-to-end demo target: **客户跟进看板 (Customer Follow-up Board)**.
