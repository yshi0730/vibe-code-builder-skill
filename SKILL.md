---
name: vibe-code-builder
description: Convert a natural-language app requirement into a working dashboard, a persistent agent, and a workspace artifact bundle. One-shot pipeline.
version: 0.1.0
user-invocable: false
metadata:
  openclaw:
    emoji: "✨"
    requires:
      bins: [node, talenthub]
---

# Vibe Code Builder Skill

This skill is invoked once per user request. It runs a 9-step pipeline that converts a natural-language requirement into a complete, deployed app.

## Pipeline overview

```
INPUT: { request, user_id, device_serial, workspace_root, locale }
  ↓
[1] parse-requirement      → semantic schema (entities, fields, widgets, persona)
[2] compose-widgets        → concrete widget configs + sample data
[3] fetch-style            → palette + typography + layout (from open-design.ai)
[4] (local) generate agent_id
[5] register-dashboard-module → write to shared.db (module + widgets)
[6] generate-agent-files   → render templates → manifest.json + IDENTITY/USER/SOUL
[7] write-sample-artifact  → HTML sample report in workspace
[8] publish-and-hire       → talenthub publish + auto-hire for user
[9] (local) emit summary JSON
```

## Tools

### parse-requirement

Parse natural-language requirement into a semantic schema.

**Input:**
- `text` (string): user's requirement, e.g., "我要一个客户跟进看板"
- `locale` ("zh-CN" | "en")

**Output (JSON):**
```json
{
  "app_name": "客户跟进看板",
  "agent_id_slug": "customer-followup",
  "purpose": "管理潜在客户和销售线索，记录联系状态和跟进计划",
  "data_model": [
    {
      "entity": "customer",
      "fields": [
        {"name": "name", "type": "string", "required": true, "description": "联系人姓名"},
        {"name": "company", "type": "string", "required": false, "description": "公司"},
        {"name": "phone", "type": "string", "required": false, "description": "电话"},
        {"name": "stage", "type": "enum", "values": ["冷线","温线","热线","已签约","已流失"], "required": true, "description": "客户阶段"},
        {"name": "last_contact", "type": "date", "required": false, "description": "上次联系日期"},
        {"name": "next_followup", "type": "date", "required": false, "description": "下次跟进日期"},
        {"name": "notes", "type": "text", "required": false, "description": "备注"}
      ]
    }
  ],
  "key_widgets": ["kpi_card", "table", "pie_chart", "bar_chart", "activity_log"],
  "agent_persona": {
    "name": "客户跟进助理",
    "vibe": "实用、主动提醒、帮你记录每次跟进的关键点",
    "emoji": "📇",
    "language": "zh-CN"
  },
  "assumptions": ["未指定 CRM 阶段, 默认采用冷线/温线/热线/已签约/已流失"]
}
```

Implementation: `src/parser.ts` — calls Claude with a structured-output prompt + JSON schema validation.

### compose-widgets

Generate concrete widget configs from a data model.

**Input:** `app_name`, `data_model`, `key_widgets`

**Output:**
```json
{
  "widgets": [
    {
      "type": "kpi_card",
      "title": "本周新增联系人",
      "config": {"subtitle": "{count} 待跟进", "trend": "up"},
      "data": [12],
      "position": 0
    },
    {
      "type": "table",
      "title": "客户列表",
      "config": {},
      "data": [<sample rows>],
      "position": 4
    }
    // ...
  ],
  "sample_data": {
    "customer": [
      {"name": "张总", "company": "字节跳动", "phone": "138...", "stage": "温线", ...},
      // 10-15 rows
    ]
  }
}
```

Implementation: `src/widget-composer.ts` — rule-based composition (one entity → table widget; enum field → pie chart; date field → trend bar chart) + Claude-driven KPI selection.

### fetch-style

Fetch visual style from open-design.ai or local fallback.

**Input:** `app_type` (e.g., "CRM"), `description`

**Output:**
```json
{
  "palette": {
    "primary": "#5B6CFF",
    "secondary": "#FFB05A",
    "accent": "#19C2A3",
    "neutral": "#F3F4F6",
    "success": "#22C55E",
    "warning": "#F59E0B",
    "danger": "#EF4444"
  },
  "font_family": "Inter, 'PingFang SC', system-ui, sans-serif",
  "layout_recipe": "dashboard-grid",
  "source_url": "https://open-design.ai/projects/xyz" 
}
```

Implementation: `src/style-fetcher.ts`. Behavior:
1. Build a search query from `app_type` + `description`
2. Query open-design.ai (5s timeout)
3. Pick top match, extract palette via DOM scrape or their API (TBD — depends on what open-design.ai exposes)
4. On timeout/error: load `assets/styles/{layout_recipe}.json` fallback

### register-dashboard-module

Insert a dashboard module + widget rows into `~/.claw/shared/shared.db`. Transactional.

**Input:** `agent_id`, `module_name`, `icon`, `widgets` (from compose-widgets output)

**Output:** `module_id`

Implementation: `src/dashboard-register.ts` — wraps the dashboard skill's existing `dashboard_register_module` + bulk widget inserts in a single transaction.

### generate-agent-files

Render templates into a generated agent's prompt file bundle.

**Input:** all collected fields (app_name, agent_id, persona, data_model, widgets, style, module_id, workspace_path, dashboard_url) + `output_dir`

**Output:** writes 4 files to `output_dir`:
- `manifest.json`
- `IDENTITY.md`
- `USER.md`
- `SOUL.md`

Templates: `templates/generated-agent/*.tpl` — Jinja2-style placeholders `{{VAR}}`.

Implementation: `src/agent-generator.ts`.

### write-sample-artifact

Generate a sample HTML report and write it into the workspace.

**Input:** `app_name`, `data_model`, `sample_data`, `style`, `workspace_path`

**Output:** absolute path to the HTML file written

Implementation: `src/sample-artifact.ts`. Generates a single self-contained HTML file showing what a "week 1 report" would look like for this app. Uses the fetched style.

### publish-and-hire

Publish the generated agent to TalentHub and auto-hire it for the requesting user.

**Input:** `output_dir`, `user_id`

**Output:** `agent_id`, `version` (registry version assigned), `dashboard_url`

Implementation: `src/publisher.ts`. Wraps `talenthub agent publish --dir <output_dir>` + auto-hire API call (auto-hire endpoint TBD — colleague's runtime piece). Tracks all created resources for rollback.

## Generated agent design

The generated agent's manifest references:
- `claw-dashboard-skill` (so it can update widgets / add data)
- `workspace-skill` (TBD — placeholder until colleague provides the URL; see CONFIG.md)

The generated agent's USER.md is templated to include:
- Its specific app context (entity schema, dashboard module_id, workspace path)
- Iteration instructions ("when user adds a record, write to widget data; when user asks for a report, generate HTML in workspace")
- A "first interaction" hint (be brief — user already saw the dashboard)

It does NOT have a WAKE-UP-INTRO.md. The first interaction is shaped by the persona in IDENTITY.md + USER.md context.

## Lite Builder (subset, used by generated agents)

The generated agent doesn't need the full builder skill. It just needs to mutate its own dashboard / workspace. These mutation operations are provided through the **existing** dashboard-skill tools (`update_widget`, `add_widget`, etc.) — no separate "lite builder" skill is needed.

The agent's USER.md tells it how to invoke those tools for common iteration patterns:
- "add a phone field" → fetch existing table widget, append column, write back
- "show me X by month" → add a new bar_chart widget aggregating data
- "export to CSV" → query data, write CSV to workspace

If a user request goes beyond mutation (e.g., "actually I want this to be a kanban instead of a table"), the generated agent should suggest the user go back to the web entry point to "create a new app". This boundary keeps the iteration surface small and predictable.
