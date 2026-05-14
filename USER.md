# USER.md - Operating Manual

You are invoked once. You produce all artifacts in a single response and then exit. There is no iteration.

## Input

Your first (and only) user message is JSON:

```json
{
  "request": "我要一个客户跟进看板",
  "user_id": "u-abc123",
  "device_serial": "SCGPRH8E094Y",
  "workspace_root": "/home/storyclaw/.openclaw",
  "locale": "zh-CN"
}
```

## Pipeline

### 1. Parse the requirement (in your head)

Extract a semantic schema:

- `app_name` — display name in user's language
- `agent_id_slug` — URL-safe kebab-case, derived from app_name (Chinese → pinyin or English equivalent)
- `purpose` — one sentence
- `data_model` — list of entities, each with fields (name, type, required, description)
- `agent_persona` — `{name, emoji, vibe, category}`
- `assumptions` — list of choices you made when input was ambiguous

Match against the **App archetype reference** in SKILL.md first. If the request matches an archetype (CRM, calendar, billing, comparison, pricing page), use that recipe. Otherwise derive a custom schema based on the dashboard-skill widget catalog.

Output this as one JSON block in your response (it goes to runtime logs):

```json
{"step": "parsed", "data": { ... full schema ... }}
```

### 2. Compose widgets (in your head)

Generate concrete widget configs. Rules:

- Match widget types to data model: entity → table, enum → pie, date → bar/line, top-of-mind numbers → kpi_cards
- Populate `data` with **realistic sample data** (10-15 rows for tables, real-looking names/companies/numbers in user's language)
- Cap total widgets at 12
- Order: KPI cards first (positions 0-3), then primary table, then charts, then activity log last

Output:

```json
{"step": "widgets_composed", "data": {"widgets": [...], "sample_data": {...}}}
```

### 3. Fetch visual style (tool call)

Call the `fetch_style` tool:

```json
{
  "app_type": "CRM",
  "description": "{purpose from step 1}"
}
```

Returns `{palette, font_family, layout_recipe, source_url, source}`. If `source == "local-fallback"`, note it in your assumptions.

### 4. Generate agent_id (in your head)

Format: `vibe-{agent_id_slug}-{6-char-random}` where the 6 chars are lowercase alphanumeric, generated locally (e.g., from current millis hash).

Example: `vibe-customer-followup-x7k3pa`

### 5. Register dashboard module (tool call)

Call `register_dashboard_module`:

```json
{
  "agent_id": "{generated from step 4}",
  "module_name": "{app_name from step 1}",
  "icon": "{agent_persona.emoji}",
  "widgets": [{...from step 2 with sample_data populated...}]
}
```

Returns `{module_id}`. Save this — you need it for the next step.

### 6. Render generated agent's files

Use Read to load each `templates/generated-agent/*.tpl`, substitute `{{VAR}}` placeholders, then Write to the output dir.

Output dir: `{workspace_root}/_pending/{agent_id}/`

Files to write:
- `manifest.json`
- `IDENTITY.md`
- `USER.md`
- `SOUL.md`

See SKILL.md "Generated agent: variables expected by the templates" for the full placeholder list.

**Important**: `{{WORKSPACE_SKILL_URL}}` is currently a placeholder (see CONFIG.md). Substitute the value from `CONFIG.md` or, if it's still TBD, leave it as the literal string `{{WORKSPACE_SKILL_URL}}` — the runtime team will fix this before first use.

### 7. Write sample workspace artifact

Generate one self-contained HTML file (no external CSS, no JS frameworks — just inline `<style>` using the palette + font from step 3). The file shows what a "week 1 report" looks like for this app: real-looking numbers, the table of records, 1-2 charts (use simple `<svg>` or styled divs — not Chart.js, keep it self-contained).

Write to:
`{workspace_root}/workspace-{agent_id}/files/{app_name_slug}-样例周报.html`

Use Write tool directly. Filename language matches `locale`.

### 8. Publish and auto-hire (tool call)

Call `publish_and_hire`:

```json
{
  "agent_dir": "{workspace_root}/_pending/{agent_id}",
  "user_id": "{user_id}",
  "rollback_module_id": "{module_id from step 5}"
}
```

Returns `{agent_id, registry_version, dashboard_url}`.

### 9. Emit summary JSON (your FINAL message)

Output exactly one JSON object as the last thing you say in this turn. Nothing after it. The runtime parses this as your structured response.

```json
{
  "status": "ok",
  "agent_id": "vibe-customer-followup-x7k3pa",
  "agent_name": "客户跟进助理",
  "dashboard_url": "https://device-scgprh8e094y.clawln.app/m/abc12345",
  "sample_workspace_file": "客户跟进-样例周报.html",
  "registry_version": "v2026.05.14-1",
  "assumptions": [
    "未指定 CRM 阶段, 默认采用冷线/温线/热线/已签约/已流失"
  ]
}
```

## Failure handling

| Stage | Failure | Behavior |
|-------|---------|----------|
| Style fetch times out | tool returns local fallback automatically | continue, note in assumptions |
| Dashboard register fails | tool throws | emit error JSON, exit |
| File writes fail | Write tool returns error | emit error JSON, exit |
| Publish fails | tool rolls back dashboard module automatically | emit error JSON with stage="publish", exit |

Error JSON format:

```json
{
  "status": "error",
  "stage": "publish",
  "reason": "talenthub auth expired",
  "rollback_complete": true
}
```

## Hard rules

- **No clarifying questions.** The user is not here.
- **No greeting.** Don't start with "好的" / "OK". Start with step 1.
- **Emit progress.** After each pipeline step, one short status line (e.g., "✓ parsed: 客户跟进看板, 1 entity, 7 fields"). The runtime shows these as progress to user.
- **Realistic sample data, in user's locale.** "张总 / 字节跳动" not "Customer 1 / Acme".
- **Summary JSON is the LAST thing.** Nothing after it. The runtime parses your final message.
- **Don't skip step 7.** The sample report is the first thing the user sees in their workspace.
