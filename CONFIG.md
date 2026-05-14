# CONFIG.md - Configuration & Placeholders

This document tracks values that must be filled in **before** the builder can run end-to-end.

## Required placeholders

### `WORKSPACE_SKILL_URL`

**Status**: ⏳ Pending — waiting for colleague to provide the workspace skill repo URL.

**Where it appears**:
- `templates/generated-agent/manifest.json.tpl` → in the `skills` array as `{{WORKSPACE_SKILL_URL}}`

**Expected format**:
```
https://github.com/<owner>/<repo>@<skill-name>
```

Example (placeholder — replace with actual URL):
```
https://github.com/storyclaw/workspace-reporter-skill@workspace
```

**What it does**: Allows generated agents to register files (HTML, PDF, CSV) into the user's workspace panel. Required for the "user sees and downloads outputs in workspace" UX described in the agent brief.

**How to update**:
1. Get URL from colleague
2. Replace `{{WORKSPACE_SKILL_URL}}` in `templates/generated-agent/manifest.json.tpl`
3. Replace any other references in `src/*.ts` (search the repo)

### `AUTO_HIRE_ENDPOINT`

**Status**: ⏳ Pending — waiting for colleague to expose an auto-hire API.

**Where it appears**:
- `src/publisher.ts` → after `talenthub agent publish`, the publisher needs to call this endpoint to hire the newly-created agent for the requesting `user_id` automatically.

**Expected**: Some kind of HTTP POST or CLI call that does the equivalent of clicking "雇佣" in the web UI on behalf of a specific user.

**Fallback while we wait**: `publish-and-hire` will only publish; the user will need to manually click "雇佣" once on the web UI after build. UX is degraded but functional.

### `OPEN_DESIGN_AI_ENDPOINT` — ✅ Resolved

We pull directly from `nexu-io/open-design` GitHub repo via raw.githubusercontent.com (no API key needed, CDN-cached, ~50-300ms).

Implementation: `src/tools/fetch-style.ts`. Each app_type has a curated list of design system names (e.g. `linear-app`, `airtable`, `notion` for CRM); one is randomly picked per request to give visual variety. The DESIGN.md is parsed for hex codes (HSL-classified into palette roles) and typography (regex match against known font family names).

Tested against 12 design systems; all produce brand-appropriate palettes. See `tests/fetch-style.test.ts` for the smoke test.

## Optional / future configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `MAX_WIDGETS_PER_APP` | 12 | Cap generated dashboard size |
| `SAMPLE_DATA_ROW_COUNT` | 10 | Rows of realistic example data per entity |
| `STYLE_FETCH_TIMEOUT_MS` | 5000 | open-design.ai timeout before fallback |
| `GENERATED_AGENT_MODEL` | `claude-sonnet-4-6` | Default LLM for generated agents |
