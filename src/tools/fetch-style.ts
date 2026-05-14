import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS_DIR = join(__dirname, "../../assets/styles");
const TIMEOUT_MS = 5_000;

const VALID_APP_TYPES = [
  "CRM",
  "calendar",
  "billing",
  "comparison",
  "pricing-page",
  "other",
] as const;

interface StyleResult {
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    neutral: string;
    success: string;
    warning: string;
    danger: string;
  };
  font_family: string;
  layout_recipe: "dashboard-grid" | "kanban" | "list-detail" | "form-heavy";
  source_url: string;
  source: "open-design.ai" | "local-fallback";
}

async function loadLocalFallback(appType: string): Promise<StyleResult> {
  // try specific app-type file first, then dashboard-grid default
  const candidates = [`${appType}.json`, "dashboard-grid.json"];
  for (const filename of candidates) {
    try {
      const text = await readFile(join(ASSETS_DIR, filename), "utf-8");
      const parsed = JSON.parse(text) as Omit<StyleResult, "source">;
      return { ...parsed, source: "local-fallback" };
    } catch {
      // try next
    }
  }
  // last-resort hardcoded default
  return {
    palette: {
      primary: "#5B6CFF",
      secondary: "#FFB05A",
      accent: "#19C2A3",
      neutral: "#F3F4F6",
      success: "#22C55E",
      warning: "#F59E0B",
      danger: "#EF4444",
    },
    font_family: "Inter, 'PingFang SC', system-ui, sans-serif",
    layout_recipe: "dashboard-grid",
    source_url: "",
    source: "local-fallback",
  };
}

async function tryOpenDesignAi(
  appType: string,
  description: string,
): Promise<StyleResult | null> {
  // TODO: implement real scraping or API call once we figure out their endpoints.
  // For day-1 we rely entirely on local-fallback. Returning null triggers fallback.
  //
  // Sketch of intended impl:
  //   const url = `https://open-design.ai/search?q=${encodeURIComponent(appType + " " + description)}`;
  //   const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  //   const html = await res.text();
  //   const $ = cheerio.load(html);
  //   const firstResult = $(".design-card").first();
  //   ... extract palette from CSS vars or attrs ...
  void appType;
  void description;
  void TIMEOUT_MS;
  return null;
}

export function registerFetchStyleTool(server: McpServer): void {
  server.tool(
    "fetch_style",
    "Fetch visual style (palette + typography + layout) for a generated app. Tries open-design.ai with a 5s timeout, falls back to curated local library. Always returns a valid style — never throws.",
    {
      app_type: z.enum(VALID_APP_TYPES).describe("App archetype"),
      description: z.string().describe("Free-text app description (used to refine search)"),
    },
    async ({ app_type, description }) => {
      let result: StyleResult;
      try {
        const remote = await tryOpenDesignAi(app_type, description);
        result = remote ?? (await loadLocalFallback(app_type));
      } catch {
        result = await loadLocalFallback(app_type);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
