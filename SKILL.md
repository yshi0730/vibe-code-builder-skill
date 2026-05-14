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

The agent (Claude) does the reasoning. This skill provides only the **3 IO-bound tools** the agent can't do well on its own: fetching visual styles from the web, writing transactionally to the shared dashboard DB, and publishing the generated agent through `talenthub`.

Everything else — parsing the request, designing the data model, picking widgets, generating sample data, rendering template files, writing the sample HTML report — is done by the agent directly via prompt + Read/Write.

## Tools

### 1. `fetch_style`

Fetch visual style (palette + typography + layout recipe) from the `nexu-io/open-design` GitHub repo or local fallback. open-design is a local-first design tool repo containing **150+ brand-grade design systems** (apple, stripe, linear-app, notion, vercel, cohere, etc.) each as a structured `DESIGN.md` with explicit hex codes, typography, and role descriptions. We fetch one `DESIGN.md` per request and parse it.

**Input:**
```json
{
  "app_type": "CRM | calendar | billing | comparison | pricing-page | other",
  "description": "free-text description of the app (reserved for future use)"
}
```

**Output:**
```json
{
  "palette": {
    "primary": "#0070f3",
    "secondary": "#0072f5",
    "accent": "#eb367f",
    "neutral": "#ffffff",
    "success": "#22C55E",
    "warning": "#F59E0B",
    "danger": "#ff5b4f"
  },
  "font_family": "Roboto, 'PingFang SC', system-ui, sans-serif",
  "layout_recipe": "dashboard-grid",
  "source_url": "https://github.com/nexu-io/open-design/blob/main/design-systems/vercel/DESIGN.md",
  "source": "open-design" | "local-fallback",
  "source_system": "vercel"
}
```

**Behavior:**
1. Each app_type maps to a curated list of design systems (e.g. CRM → linear-app, airtable, notion, cohere, clean, application)
2. Randomly pick one for variety across requests
3. Fetch `https://raw.githubusercontent.com/nexu-io/open-design/main/design-systems/{name}/DESIGN.md` (5s timeout)
4. Extract all hex codes, classify by HSL into primary/secondary/accent/neutral/success/warning/danger
5. Detect font family by matching well-known names (SF Pro, Inter, Geist, Roboto, Poppins, etc.)
6. On fetch failure / too few colors: try one alternate system, then fall back to `assets/styles/{app_type}.json`
7. Always returns a valid palette — never throws

### 2. `register_dashboard_module`

Atomically register a new dashboard module + all its widgets in `~/.claw/shared/shared.db`. Transactional — module + widgets succeed together or both rollback.

**Input:**
```json
{
  "agent_id": "vibe-customer-followup-x7k3pa",
  "module_name": "客户跟进看板",
  "icon": "📇",
  "widgets": [
    {
      "type": "kpi_card",
      "title": "本周新增联系人",
      "config": {"subtitle": "5 待跟进", "trend": "up"},
      "data": [12],
      "position": 0
    }
  ]
}
```

**Output:**
```json
{ "module_id": "abc12345" }
```

**Behavior:**
- Creates `dashboard_modules` and `dashboard_widgets` tables if missing
- Single transaction: rollback on any widget failure
- Returns the generated `module_id` for use in `dashboard_url` and template substitution

### 3. `publish_and_hire`

Run `talenthub agent publish` on the generated agent dir, then auto-hire it for the requesting user. Handles auth via the `talenthub` CLI's existing credentials.

**Input:**
```json
{
  "agent_dir": "/path/to/generated/agent",
  "user_id": "u-abc123",
  "rollback_module_id": "abc12345"
}
```

**Output:**
```json
{
  "agent_id": "vibe-customer-followup-x7k3pa",
  "registry_version": "v2026.05.13-1",
  "dashboard_url": "https://device-xxx.clawln.app/m/abc12345"
}
```

**Behavior:**
- Validates agent dir has manifest.json + IDENTITY.md before publishing
- Captures `talenthub publish` stdout for the registry version string
- Calls auto-hire endpoint (TBD — see CONFIG.md)
- On publish failure: deletes the dashboard module via `rollback_module_id` so we don't leave orphan rows

---

## How the agent does the rest

The agent reads its `USER.md` pipeline and follows it. The pipeline reasons through these steps without calling tools:

- **Parse the requirement** — extract `app_name`, `agent_id_slug`, `purpose`, `data_model`, `key_widgets`, `agent_persona`, `assumptions`. Output as a JSON object in the agent's response (visible to runtime logs).
- **Compose widgets** — pick widget types from the dashboard skill's catalog (see below) and populate `config` + realistic `sample_data` rows. Match widget choices to the data model:
  - Each entity → 1 table widget showing rows
  - Each enum field → 1 pie chart of value distribution
  - Each date field → 1 bar chart of weekly trend
  - Up to 4 KPI cards for top-of-mind numbers
  - 1 activity log if the app has an event/log nature
- **Render templates** — Read each `templates/generated-agent/*.tpl`, substitute `{{VAR}}` placeholders inline, Write to `{output_dir}/{filename}`.
- **Write sample HTML report** — generate a self-contained HTML using the fetched palette + font + 3-5 realistic data points, Write to `{workspace_path}/files/{app-name}-样例报告.html`.

The agent **only** calls tools for: fetching style, writing the dashboard DB, publishing.

---

## Widget catalog reference

These are the widget types supported by `claw-dashboard-skill`. The agent picks from this list.

| Type | Data shape | Config keys | Best for |
|------|------------|-------------|----------|
| `kpi_card` | `[number]` | `prefix`, `suffix`, `trend`, `subtitle`, `tag`, `tag_color` | Headline numbers (count, total, %) |
| `table` | `[{col: val, ...}, ...]` | none — columns inferred from keys | Lists of records |
| `pie_chart` | `[val1, val2, ...]` | `labels[]`, `colors[]` | Distribution of an enum field |
| `bar_chart` | `[v1, v2, ...]` | `labels[]`, `color` | Trend over discrete buckets |
| `line_chart` | `[v1, v2, ...]` | `labels[]`, `color`, `dataset_label`, `prefix` | Trend over time |
| `activity_log` | `[{time, action, ...}, ...]` | none | Event stream with optional `logic` AI-reasoning blocks |
| `strategy_list` | `[{name, description, status}]` | none | Running processes / rules |
| `stat_row` | `[{label, value}, ...]` | none | Compact stats grid |
| `text` | `[string]` | none | Notes, banners, instructions |

**A column named `"Logic"` or `"Reasoning"` in a table renders with a blue left-border as an AI-reasoning block.**

---

## App archetype reference

Day-1 target is **CRM (客户跟进看板)**. The other 4 are sketched as one-paragraph hints — the agent's reasoning fills in details for those when triggered.

### 🎯 CRM / 客户跟进看板 (full recipe — day 1)

**Triggers**: "客户跟进", "销售看板", "联系人管理", "sales pipeline", "CRM"

**Entity**: `customer`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | 联系人姓名 |
| `company` | string | no | 公司 |
| `phone` | string | no | 电话 |
| `stage` | enum: 冷线/温线/热线/已签约/已流失 | yes | 阶段 |
| `last_contact` | date | no | 上次联系 |
| `next_followup` | date | no | 下次跟进 |
| `notes` | text | no | 备注 |

**Widgets** (8 total, in this order):

1. `kpi_card` "本周新增联系人" — count of customers created in last 7 days, subtitle: "{n} 待跟进"
2. `kpi_card` "需跟进客户" — count where `next_followup <= today + 3 days`, trend
3. `kpi_card` "本月转化率" — `(已签约 / total touched this month) * 100`, suffix: %
4. `kpi_card` "本月新增" — count of customers created this month
5. `table` "客户列表" — full customer table; columns: 姓名/公司/电话/阶段/上次联系/下次跟进/备注
6. `pie_chart` "客户阶段分布" — counts per stage
7. `bar_chart` "8 周新增趋势" — weekly counts
8. `activity_log` "最近跟进" — sample log entries with AI-suggested next action

**Sample data**: 10-15 customers with realistic Chinese names + companies (e.g., "张总 / 字节跳动 / 温线"). Mix stages roughly: 3 冷线, 4 温线, 3 热线, 2 已签约, 1 已流失.

**Agent persona**:
- name: "客户跟进助理"
- emoji: 📇
- vibe: "实用、主动提醒、帮你记录每次跟进的关键点"
- category: `marketing-growth`

### 📅 Content Calendar / 内容排期面板

**Triggers**: "内容排期", "发布计划", "content calendar"

Entity: `post` — title, platform (enum), publish_date, status (enum: 草稿/已排期/已发布), content, performance_metrics

Widgets: KPI(本周排期数, 待发布数, 上周阅读量), table(内容列表), pie(平台分布), line(每周阅读量趋势)

Persona: 内容排期助理 📅, category: `content-operations`

### 💰 Billing / 家庭账单记录器

**Triggers**: "家庭账单", "记账", "billing tracker", "支出记录"

Entity: `expense` — date, amount, category (enum), description, payer

Widgets: KPI(本月支出, 同比, 大宗支出占比), table(支出明细), pie(分类占比), bar(月度趋势)

Persona: 家庭账单助理 💰, category: `personal-assistant`

### 🛒 Purchase Comparison / 采购比价工具

**Triggers**: "采购比价", "价格对比", "供应商比较"

Entity: `option` — vendor, product_name, price, currency, lead_time, rating, link

Widgets: KPI(最低价, 最快交期), table(比价表 — 含 price/lead_time/rating 三列), stat_row(供应商数 / 平均价格)

Persona: 采购比价助手 🛒, category: `marketing-growth`

### 📊 Pricing Page / AI API 经销商报价页

**Triggers**: "API 报价", "经销商报价", "pricing page", "服务报价"

Entity: `tier` — name, price_monthly, included_quota, overage_rate, target_audience, features (text)

Widgets: table(三档对比 — 字段横向), stat_row(总月费/总额度), text(SLA / 售后条款)

Persona: 报价页助理 📊, category: `marketing-growth`

---

## Style library fallback

When `fetch_style` falls back to local, it reads from `assets/styles/{app_type}.json`. The agent doesn't need to know these directly; the tool returns them in the same format.

Pre-curated layouts:
- `dashboard-grid` — most common, 12-column grid, mix of cards + table + charts
- `kanban` — column-based, status-stage flow (for CRM, content calendar)
- `list-detail` — sidebar list + main detail pane (for comparison tools)
- `form-heavy` — top form + bottom data view (for billing, surveys)

---

## Generated agent: variables expected by the templates

When rendering `templates/generated-agent/*.tpl`, substitute these placeholders:

| Placeholder | Source |
|------------|--------|
| `{{AGENT_ID}}` | agent generates: `vibe-{slug}-{6char-random}` |
| `{{AGENT_DISPLAY_NAME}}` | from `agent_persona.name` |
| `{{AGENT_EMOJI}}` | from `agent_persona.emoji` |
| `{{AGENT_VIBE}}` | from `agent_persona.vibe` |
| `{{AGENT_ROLE}}` | one-line role description |
| `{{AGENT_TAGLINE}}` | one-line tagline for marketplace |
| `{{AGENT_DESCRIPTION}}` | 1-2 paragraph description |
| `{{AGENT_CATEGORY}}` | one of: content-operations / financial-trading / agent-building / marketing-growth / personal-assistant / engineering-development / research-intelligence |
| `{{APP_NAME}}` | from parse step |
| `{{APP_PURPOSE}}` | from parse step |
| `{{DATA_SCHEMA_MARKDOWN}}` | markdown table summarizing entities + fields |
| `{{WIDGETS_SUMMARY}}` | markdown list of widget titles + types |
| `{{MODULE_ID}}` | returned by `register_dashboard_module` |
| `{{DASHBOARD_URL}}` | returned by `publish_and_hire` |
| `{{WORKSPACE_PATH}}` | from input metadata |
| `{{WORKSPACE_SKILL_URL}}` | from CONFIG.md (TBD until colleague provides) |
| `{{LOCALE}}` | from input metadata |
| `{{FIRST_INTERACTION_HINT}}` | agent writes 1-2 sentences appropriate to the app type |
| `{{BUILDER_ASSUMPTIONS}}` | bulleted list from parse step's `assumptions` |
| `{{CREATED_AT_ISO}}` | current ISO timestamp |
| `{{ORIGINAL_REQUEST}}` | the user's original natural-language request |
