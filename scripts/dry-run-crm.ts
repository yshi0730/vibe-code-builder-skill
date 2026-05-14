/**
 * End-to-end dry-run of the Vibe App Builder pipeline.
 *
 * Simulates what would happen when a user types "我要一个客户跟进看板"
 * into the web entry box. Skips shared.db writes and talenthub publish.
 *
 * Produces:
 *   dry-run/{agent_id}/
 *     manifest.json
 *     IDENTITY.md
 *     USER.md
 *     SOUL.md
 *   dry-run/sample-report.html   ← open in Safari to preview
 *   dry-run/widgets.json         ← what would go into shared.db
 *   dry-run/style.json           ← what fetch_style returned
 *   dry-run/summary.json         ← final summary JSON the runtime would return
 *
 * Usage: npx tsx scripts/dry-run-crm.ts
 */

import { getStyleForAppType } from "../src/tools/fetch-style.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const OUTPUT_DIR = join(ROOT, "dry-run");
const TEMPLATES_DIR = join(ROOT, "templates/generated-agent");

// ──────────────────────────────────────────────────────────────────
// Step 1: parse (agent would reason; hard-coded here for dry-run)
// ──────────────────────────────────────────────────────────────────

const REQUEST = "我要一个客户跟进看板";
const LOCALE = "zh-CN";
const USER_ID = "u-drytest";

const parsed = {
  app_name: "客户跟进看板",
  agent_id_slug: "customer-followup",
  purpose: "管理潜在客户和销售线索，记录联系状态、跟进计划和决策节点",
  data_model: [
    {
      entity: "customer",
      fields: [
        { name: "name", type: "string", required: true, description: "联系人姓名" },
        { name: "company", type: "string", required: false, description: "公司" },
        { name: "phone", type: "string", required: false, description: "电话" },
        {
          name: "stage",
          type: "enum",
          values: ["冷线", "温线", "热线", "已签约", "已流失"],
          required: true,
          description: "客户阶段",
        },
        { name: "last_contact", type: "date", required: false, description: "上次联系" },
        { name: "next_followup", type: "date", required: false, description: "下次跟进" },
        { name: "notes", type: "text", required: false, description: "备注" },
      ],
    },
  ],
  agent_persona: {
    name: "客户跟进助理",
    emoji: "📇",
    vibe: "实用、主动提醒、帮你记录每次跟进的关键点",
    category: "marketing-growth",
  },
  assumptions: [
    "未指定客户阶段, 默认采用冷线/温线/热线/已签约/已流失 5 段式",
    "未指定提醒机制, 默认 next_followup 在 3 天内的客户进入 KPI 提醒",
  ],
};

// ──────────────────────────────────────────────────────────────────
// Step 2: compose widgets + sample data (agent's "in head" step)
// ──────────────────────────────────────────────────────────────────

const sampleCustomers = [
  { name: "张总", company: "字节跳动", phone: "138****1234", stage: "温线", last_contact: "2026-05-08", next_followup: "2026-05-14", notes: "在评估 AI 工具采购" },
  { name: "李志强", company: "美团", phone: "139****5678", stage: "冷线", last_contact: "2026-04-15", next_followup: "", notes: "需要更多预算批准" },
  { name: "王董事", company: "腾讯", phone: "186****9012", stage: "热线", last_contact: "2026-05-12", next_followup: "2026-05-15", notes: "本周内做决策" },
  { name: "陈彦", company: "蔚来", phone: "150****3456", stage: "已签约", last_contact: "2026-05-10", next_followup: "2026-05-25", notes: "合同已签, 启动会" },
  { name: "刘倩", company: "小米", phone: "159****7890", stage: "温线", last_contact: "2026-05-05", next_followup: "2026-05-16", notes: "评估第二轮" },
  { name: "周文豪", company: "京东", phone: "138****2345", stage: "冷线", last_contact: "2026-04-22", next_followup: "", notes: "首次接触, 等待回复" },
  { name: "杨柳", company: "B 站", phone: "186****6789", stage: "热线", last_contact: "2026-05-11", next_followup: "2026-05-14", notes: "技术演示后, 准备签约" },
  { name: "黄敏", company: "拼多多", phone: "139****4567", stage: "已签约", last_contact: "2026-04-30", next_followup: "2026-06-01", notes: "续约阶段" },
  { name: "吴雪", company: "快手", phone: "157****8901", stage: "已流失", last_contact: "2026-04-10", next_followup: "", notes: "竞品胜出" },
  { name: "马奇", company: "理想", phone: "189****1234", stage: "温线", last_contact: "2026-05-09", next_followup: "2026-05-17", notes: "POC 进行中" },
];

const activityLog = [
  { time: "05-12 14:30", action: "更新", customer: "王董事", note: "本周内做决策, 准备签约", logic: "腾讯团队已通过技术评估, 现在卡在预算批准。距离决策窗口 < 3 天 → 建议本周内主动跟进, 推动签约" },
  { time: "05-12 10:15", action: "新增", customer: "马奇", note: "理想 POC 启动", logic: "用户首次接触, 已进入 POC 阶段。建议每周一次同步, 关键节点提醒" },
  { time: "05-11 16:45", action: "更新", customer: "杨柳", note: "技术演示通过", logic: "B 站演示后客户进入热线状态。下一步: 准备商务合同模板, 安排终审会" },
  { time: "05-10 09:00", action: "签约", customer: "陈彦", note: "蔚来合同已签", logic: "签约成功! 进入实施阶段。安排启动会日期, 设置 30 天 check-in 提醒" },
  { time: "05-09 11:20", action: "更新", customer: "刘倩", note: "小米第二轮评估", logic: "客户进入温线, 第二轮评估完成。建议 7 天内主动 follow-up, 防止丢单" },
];

const stageCounts = {
  冷线: sampleCustomers.filter((c) => c.stage === "冷线").length,
  温线: sampleCustomers.filter((c) => c.stage === "温线").length,
  热线: sampleCustomers.filter((c) => c.stage === "热线").length,
  已签约: sampleCustomers.filter((c) => c.stage === "已签约").length,
  已流失: sampleCustomers.filter((c) => c.stage === "已流失").length,
};

const widgets = [
  { type: "kpi_card", title: "本周新增联系人", config: { subtitle: "5 人待跟进", trend: "up", tag: "本周", tag_color: "green" }, data: [12], position: 0 },
  { type: "kpi_card", title: "需跟进客户", config: { subtitle: "未来 3 天内", trend: "up" }, data: [5], position: 1 },
  { type: "kpi_card", title: "本月转化率", config: { subtitle: "已签约 / 总联系", suffix: "%" }, data: [23], position: 2 },
  { type: "kpi_card", title: "本月新增", config: { subtitle: "对比上月 +35%", trend: "up" }, data: [18], position: 3 },
  { type: "table", title: "客户列表", config: {}, data: sampleCustomers.map((c) => ({ 姓名: c.name, 公司: c.company, 电话: c.phone, 阶段: c.stage, 上次联系: c.last_contact, 下次跟进: c.next_followup, 备注: c.notes })), position: 4 },
  { type: "pie_chart", title: "客户阶段分布", config: { labels: Object.keys(stageCounts), colors: ["#94A3B8", "#FFB05A", "#FF7E47", "#22C55E", "#EF4444"] }, data: Object.values(stageCounts), position: 5 },
  { type: "bar_chart", title: "8 周新增趋势", config: { labels: ["第32周", "第33周", "第34周", "第35周", "第36周", "第37周", "第38周", "本周"], color: "#5B6CFF" }, data: [4, 6, 5, 9, 8, 11, 10, 12], position: 6 },
  { type: "activity_log", title: "最近跟进", config: {}, data: activityLog.map((e) => ({ time: e.time, action: e.action, symbol: e.customer, qty: "", price: "", strategy: e.note, logic: e.logic })), position: 7 },
];

// ──────────────────────────────────────────────────────────────────
// Step 3: fetch style (real tool call)
// ──────────────────────────────────────────────────────────────────

function shortId(n = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log("[1] Parse: ✓ (hard-coded for dry-run)");
  console.log(`    app_name = ${parsed.app_name}, ${parsed.data_model[0].fields.length} fields, ${widgets.length} widgets`);

  console.log("[2] Compose widgets: ✓");
  console.log(`    ${widgets.length} widgets, ${sampleCustomers.length} sample customers, ${activityLog.length} activity entries`);

  console.log("[3] Fetch style...");
  const style = await getStyleForAppType("CRM");
  console.log(`    ✓ source: ${style.source}${style.source_system ? ` (${style.source_system})` : ""}`);
  console.log(`    palette: primary=${style.palette.primary} accent=${style.palette.accent} neutral=${style.palette.neutral}`);
  console.log(`    font: ${style.font_family}`);

  // Step 4: agent_id
  const agentId = `vibe-customer-followup-${shortId()}`;
  console.log(`[4] Generate agent_id: ${agentId}`);

  // Step 5: skip register_dashboard_module (would write to shared.db)
  const moduleId = "dry" + shortId(5);
  console.log(`[5] Register dashboard module: SKIPPED (dry-run). Would use module_id=${moduleId}`);
  await writeFile(join(OUTPUT_DIR, "widgets.json"), JSON.stringify(widgets, null, 2));
  await writeFile(join(OUTPUT_DIR, "style.json"), JSON.stringify(style, null, 2));
  console.log(`    widgets.json + style.json written to dry-run/`);

  // Step 6: render agent file bundle
  const agentDir = join(OUTPUT_DIR, agentId);
  await mkdir(agentDir, { recursive: true });
  const dashboardUrl = `http://localhost:3000/m/${moduleId}`;
  const workspacePath = `/home/storyclaw/.openclaw/workspace-${agentId}`;

  const vars: Record<string, string> = {
    AGENT_ID: agentId,
    AGENT_DISPLAY_NAME: parsed.agent_persona.name,
    AGENT_EMOJI: parsed.agent_persona.emoji,
    AGENT_VIBE: parsed.agent_persona.vibe,
    AGENT_ROLE: "客户跟进与销售线索管理",
    AGENT_TAGLINE: "帮你记录每次跟进的关键点, 主动提醒下一步",
    AGENT_DESCRIPTION: parsed.purpose,
    AGENT_CATEGORY: parsed.agent_persona.category,
    APP_NAME: parsed.app_name,
    APP_PURPOSE: parsed.purpose,
    DATA_SCHEMA_MARKDOWN: makeSchemaMarkdown(parsed.data_model),
    WIDGETS_SUMMARY: makeWidgetsSummary(widgets),
    MODULE_ID: moduleId,
    DASHBOARD_URL: dashboardUrl,
    WORKSPACE_PATH: workspacePath,
    WORKSPACE_SKILL_URL: "<<TBD-WORKSPACE-SKILL-URL>>",
    LOCALE,
    FIRST_INTERACTION_HINT: `首次开场:\n- 用一句话告诉用户 ${parsed.app_name} 已就绪 + 面板地址\n- 主动提议一个具体下一步: "想加几个客户进来吗? 告诉我姓名、公司、状态即可"\n- 不要超过 3 句话`,
    BUILDER_ASSUMPTIONS: parsed.assumptions.map((a) => `- ${a}`).join("\n"),
    CREATED_AT_ISO: new Date().toISOString(),
    ORIGINAL_REQUEST: REQUEST,
  };

  console.log("[6] Render generated agent files:");
  for (const filename of ["manifest.json.tpl", "IDENTITY.md.tpl", "USER.md.tpl", "SOUL.md.tpl"]) {
    const tpl = await readFile(join(TEMPLATES_DIR, filename), "utf-8");
    const rendered = renderTemplate(tpl, vars);
    const outName = filename.replace(".tpl", "");
    await writeFile(join(agentDir, outName), rendered);
    console.log(`    ✓ ${agentId}/${outName}`);
  }

  // Step 7: write sample HTML report
  console.log("[7] Write sample workspace artifact:");
  const html = renderSampleReport({
    appName: parsed.app_name,
    persona: parsed.agent_persona,
    customers: sampleCustomers,
    stageCounts,
    activityLog,
    style,
  });
  const samplePath = join(OUTPUT_DIR, "sample-report.html");
  await writeFile(samplePath, html);
  console.log(`    ✓ sample-report.html (${html.length} chars)`);

  // Step 8: skip publish
  console.log("[8] Publish + auto-hire: SKIPPED (dry-run)");

  // Step 9: summary
  const summary = {
    status: "ok",
    agent_id: agentId,
    agent_name: parsed.agent_persona.name,
    dashboard_url: dashboardUrl,
    sample_workspace_file: "sample-report.html",
    style_source: style.source,
    style_system: style.source_system ?? null,
    assumptions: parsed.assumptions,
    dry_run: true,
  };
  await writeFile(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("[9] Summary:");
  console.log(JSON.stringify(summary, null, 2));
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

function makeSchemaMarkdown(model: typeof parsed.data_model): string {
  const lines: string[] = [];
  for (const entity of model) {
    lines.push(`### Entity: \`${entity.entity}\``);
    lines.push("");
    lines.push("| Field | Type | Required | Description |");
    lines.push("|-------|------|----------|-------------|");
    for (const f of entity.fields) {
      const type = "values" in f && f.values ? `enum: ${f.values.join("/")}` : f.type;
      lines.push(`| \`${f.name}\` | ${type} | ${f.required ? "yes" : "no"} | ${f.description} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function makeWidgetsSummary(ws: typeof widgets): string {
  return ws.map((w, i) => `${i + 1}. **${w.title}** (\`${w.type}\`)`).join("\n");
}

function renderSampleReport(args: {
  appName: string;
  persona: typeof parsed.agent_persona;
  customers: typeof sampleCustomers;
  stageCounts: Record<string, number>;
  activityLog: typeof activityLog;
  style: Awaited<ReturnType<typeof getStyleForAppType>>;
}): string {
  const p = args.style.palette;
  const font = args.style.font_family;

  const stageColors: Record<string, string> = {
    冷线: "#94A3B8",
    温线: "#FBBF24",
    热线: "#FB923C",
    已签约: p.success,
    已流失: p.danger,
  };

  // Pie chart: build SVG
  const total = Object.values(args.stageCounts).reduce((a, b) => a + b, 0);
  let pieAngle = -90;
  const pieSlices: string[] = [];
  for (const [stage, count] of Object.entries(args.stageCounts)) {
    if (count === 0) continue;
    const portion = count / total;
    const angle = portion * 360;
    const cx = 100;
    const cy = 100;
    const r = 80;
    const startRad = (pieAngle * Math.PI) / 180;
    const endRad = ((pieAngle + angle) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = angle > 180 ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    pieSlices.push(
      `<path d="${d}" fill="${stageColors[stage] ?? p.primary}" stroke="white" stroke-width="2" />`,
    );
    pieAngle += angle;
  }
  const pieLegend = Object.entries(args.stageCounts)
    .map(
      ([stage, count]) =>
        `<div class="legend-row"><span class="legend-dot" style="background:${stageColors[stage] ?? p.primary}"></span>${stage} · ${count}</div>`,
    )
    .join("");

  // Bar chart for weekly trend
  const trendData = [4, 6, 5, 9, 8, 11, 10, 12];
  const trendMax = Math.max(...trendData);
  const bars = trendData
    .map((v, i) => {
      const h = (v / trendMax) * 140;
      const label = i === trendData.length - 1 ? "本周" : `${i + 32}周`;
      return `<div class="bar-col"><div class="bar" style="height:${h}px;background:${p.primary}"><span class="bar-value">${v}</span></div><div class="bar-label">${label}</div></div>`;
    })
    .join("");

  // Activity log items
  const activityItems = args.activityLog
    .map(
      (e) => `
    <div class="activity-item">
      <div class="activity-head">
        <span class="activity-time">${e.time}</span>
        <span class="activity-action">${e.action}</span>
        <span class="activity-customer">${e.customer}</span>
      </div>
      <div class="activity-note">${e.note}</div>
      <div class="activity-logic">
        <span class="logic-label">AI 决策</span>${e.logic}
      </div>
    </div>`,
    )
    .join("");

  // Customer table rows
  const tableRows = args.customers
    .map(
      (c) => `
    <tr>
      <td>${c.name}</td>
      <td>${c.company}</td>
      <td>${c.phone}</td>
      <td><span class="stage-pill" style="background:${stageColors[c.stage] ?? p.primary}20;color:${stageColors[c.stage] ?? p.primary};border-color:${stageColors[c.stage] ?? p.primary}40">${c.stage}</span></td>
      <td>${c.last_contact}</td>
      <td>${c.next_followup || "—"}</td>
      <td class="notes-cell">${c.notes}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${args.appName} - 周报样例</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${font};
    background: #FAFBFC;
    color: #0F172A;
    padding: 40px;
    line-height: 1.5;
  }
  .container { max-width: 1200px; margin: 0 auto; }
  header {
    background: linear-gradient(135deg, ${p.primary}, ${p.accent});
    color: white;
    padding: 32px 36px;
    border-radius: 16px;
    margin-bottom: 32px;
    box-shadow: 0 8px 24px ${p.primary}22;
  }
  header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
  header .subtitle { font-size: 14px; opacity: 0.85; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .kpi-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .kpi-label { font-size: 13px; color: #64748B; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .kpi-value { font-size: 32px; font-weight: 700; color: ${p.primary}; margin-bottom: 4px; }
  .kpi-subtitle { font-size: 12px; color: #94A3B8; }
  .kpi-tag { display: inline-block; padding: 2px 8px; font-size: 11px; border-radius: 4px; background: ${p.success}20; color: ${p.success}; font-weight: 600; margin-left: 8px; }
  .row-2col { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; margin-bottom: 32px; }
  .card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .card-title { font-size: 14px; font-weight: 600; color: #0F172A; margin-bottom: 20px; display: flex; align-items: center; gap: 6px; }
  .pie-wrap { display: flex; align-items: center; gap: 24px; }
  .pie-wrap svg { width: 200px; height: 200px; flex-shrink: 0; }
  .legend-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; margin-bottom: 10px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .bar-chart { display: flex; align-items: flex-end; gap: 12px; height: 180px; padding-top: 20px; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; }
  .bar { width: 100%; border-radius: 6px 6px 0 0; position: relative; min-height: 4px; }
  .bar-value { position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-size: 12px; color: #475569; font-weight: 600; }
  .bar-label { font-size: 11px; color: #94A3B8; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #F8FAFC; padding: 12px 14px; text-align: left; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #E5E7EB; }
  td { padding: 12px 14px; border-bottom: 1px solid #F1F5F9; font-size: 14px; color: #0F172A; }
  tbody tr:hover { background: #F8FAFC; }
  .notes-cell { color: #64748B; font-size: 13px; max-width: 240px; }
  .stage-pill { padding: 2px 10px; font-size: 12px; font-weight: 600; border-radius: 12px; border: 1px solid; }
  .activity-item { padding: 16px 0; border-bottom: 1px solid #F1F5F9; }
  .activity-item:last-child { border-bottom: none; }
  .activity-head { display: flex; gap: 8px; align-items: center; font-size: 13px; margin-bottom: 6px; }
  .activity-time { color: #94A3B8; font-family: ui-monospace, monospace; }
  .activity-action { padding: 1px 8px; background: ${p.primary}15; color: ${p.primary}; border-radius: 4px; font-weight: 600; font-size: 11px; }
  .activity-customer { font-weight: 600; color: #0F172A; }
  .activity-note { font-size: 14px; color: #334155; margin-bottom: 8px; }
  .activity-logic { background: ${p.primary}08; border-left: 3px solid ${p.primary}; padding: 8px 12px; font-size: 13px; color: #475569; border-radius: 0 6px 6px 0; }
  .logic-label { display: inline-block; padding: 1px 6px; font-size: 10px; font-weight: 700; background: ${p.primary}; color: white; border-radius: 3px; margin-right: 8px; vertical-align: middle; }
  footer { text-align: center; padding: 32px 0; color: #94A3B8; font-size: 12px; }
  footer a { color: ${p.primary}; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${args.persona.emoji} ${args.appName} · 周报样例</h1>
    <div class="subtitle">由 ${args.persona.name} 自动生成 · 周期: 2026-05-08 → 2026-05-14 · 配色源自 <strong>${args.style.source_system ?? "本地默认"}</strong> 设计系统</div>
  </header>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">本周新增联系人</div>
      <div class="kpi-value">12</div>
      <div class="kpi-subtitle">5 人待跟进 <span class="kpi-tag">+20%</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">需跟进客户</div>
      <div class="kpi-value">5</div>
      <div class="kpi-subtitle">未来 3 天内 next_followup</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">本月转化率</div>
      <div class="kpi-value">23%</div>
      <div class="kpi-subtitle">已签约 / 总联系数</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">本月新增</div>
      <div class="kpi-value">18</div>
      <div class="kpi-subtitle">对比上月 <span class="kpi-tag">+35%</span></div>
    </div>
  </div>

  <div class="row-2col">
    <div class="card">
      <div class="card-title">📊 客户阶段分布</div>
      <div class="pie-wrap">
        <svg viewBox="0 0 200 200">${pieSlices.join("")}</svg>
        <div>${pieLegend}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">📈 8 周新增趋势</div>
      <div class="bar-chart">${bars}</div>
    </div>
  </div>

  <div class="card" style="margin-bottom: 32px;">
    <div class="card-title">📋 客户列表 (${args.customers.length} 条)</div>
    <table>
      <thead><tr><th>姓名</th><th>公司</th><th>电话</th><th>阶段</th><th>上次联系</th><th>下次跟进</th><th>备注</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="card">
    <div class="card-title">🔔 最近跟进 · AI 决策日志</div>
    ${activityItems}
  </div>

  <footer>
    本报告由 <strong>Vibe App Builder</strong> 自动生成 · 配色源 · <a href="${args.style.source_url}" target="_blank">${args.style.source_system ?? "local fallback"}</a>
  </footer>
</div>
</body>
</html>`;
}

main().catch((err) => {
  console.error("DRY-RUN FAILED:", err);
  process.exit(1);
});
