import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VALID_APP_TYPES, type AppType } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS_DIR = join(__dirname, "../../assets/templates");
const TIMEOUT_MS = 5_000;

/**
 * Map app archetype → ordered list of candidate templates in
 * nexu-io/open-design/design-templates/. The first one that fetches
 * successfully wins.
 *
 * Day-1 mapping is conservative — most archetypes share the generic
 * `dashboard` template. As the design-templates catalog evolves
 * (e.g. `pricing-page`, `finance-report` matures), we widen the lists.
 */
const TEMPLATES_BY_APP_TYPE: Record<AppType, string[]> = {
  CRM: ["dashboard"],
  calendar: ["dashboard"],
  billing: ["finance-report", "dashboard"],
  comparison: ["dashboard"],
  "pricing-page": ["pricing-page", "dashboard"],
  other: ["dashboard"],
};

const GH_BASE =
  "https://raw.githubusercontent.com/nexu-io/open-design/main/design-templates";

interface TemplateResult {
  template_name: string;
  html: string;
  source_url: string;
  source: "open-design" | "local-fallback";
}

async function fetchTemplateHtml(name: string): Promise<string | null> {
  const url = `${GH_BASE}/${name}/example.html`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "vibe-code-builder-skill/0.1" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function tryOpenDesignTemplate(
  appType: AppType,
): Promise<TemplateResult | null> {
  const candidates = TEMPLATES_BY_APP_TYPE[appType];
  for (const name of candidates) {
    const html = await fetchTemplateHtml(name);
    if (html) {
      return {
        template_name: name,
        html,
        source_url: `https://github.com/nexu-io/open-design/tree/main/design-templates/${name}`,
        source: "open-design",
      };
    }
  }
  return null;
}

async function loadLocalFallback(): Promise<TemplateResult> {
  try {
    const html = await readFile(join(ASSETS_DIR, "dashboard.html"), "utf-8");
    return {
      template_name: "dashboard",
      html,
      source_url: "",
      source: "local-fallback",
    };
  } catch {
    // last-resort minimal skeleton if even the bundled fallback is missing
    return {
      template_name: "minimal",
      html: `<!doctype html><html><head><meta charset="utf-8"><title>Report</title><style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#1c1b1a}</style></head><body><h1>Report</h1><p data-od-id="placeholder">No template content available — replace this block with your widgets.</p></body></html>`,
      source_url: "",
      source: "local-fallback",
    };
  }
}

/**
 * High-level entry point used by the MCP tool, scripts, and tests.
 * Always returns a valid TemplateResult.
 */
export async function getTemplateForAppType(
  appType: AppType,
): Promise<TemplateResult> {
  return (
    (await tryOpenDesignTemplate(appType)) ?? (await loadLocalFallback())
  );
}

export function registerFetchTemplateTool(server: McpServer): void {
  server.tool(
    "fetch_template",
    "Fetch a real HTML template (sidebar + topbar + KPIs + panels) from nexu-io/open-design/design-templates/. Returns raw example.html as a starting structure that the agent then customizes by (a) swapping CSS variables for the fetched palette, (b) replacing mock English content with real localized data. Falls back to a bundled `dashboard.html` if GitHub is unreachable. Always returns a valid template — never throws.",
    {
      app_type: z
        .enum(VALID_APP_TYPES)
        .describe("App archetype — CRM / calendar / billing / comparison / pricing-page / other"),
    },
    async ({ app_type }) => {
      const result = await getTemplateForAppType(app_type);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

export const __testing = { TEMPLATES_BY_APP_TYPE, fetchTemplateHtml };
