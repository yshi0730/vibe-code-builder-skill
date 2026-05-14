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
type AppType = (typeof VALID_APP_TYPES)[number];

/**
 * Map app archetype → recommended design systems from nexu-io/open-design.
 * Each system has a DESIGN.md at design-systems/{name}/DESIGN.md.
 * We pick one randomly per request for variety.
 */
const DESIGN_SYSTEMS_BY_APP_TYPE: Record<AppType, string[]> = {
  CRM: ["linear-app", "airtable", "notion", "cohere", "clean", "application"],
  calendar: ["cal", "notion", "framer", "clean"],
  billing: ["stripe", "coinbase", "application", "clean"],
  comparison: ["vercel", "clickhouse", "clean", "linear-app"],
  "pricing-page": ["stripe", "canva", "cohere", "vercel", "framer"],
  other: ["clean", "application", "linear-app", "notion"],
};

const GH_RAW_BASE =
  "https://raw.githubusercontent.com/nexu-io/open-design/main/design-systems";

interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
  success: string;
  warning: string;
  danger: string;
}

interface StyleResult {
  palette: Palette;
  font_family: string;
  layout_recipe: "dashboard-grid" | "kanban" | "list-detail" | "form-heavy";
  source_url: string;
  source: "open-design" | "local-fallback";
  source_system?: string;
}

// ──────────────────────────────────────────────────────────────────
// Color parsing helpers
// ──────────────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

interface ColorCandidate {
  hex: string;
  h: number;
  s: number;
  l: number;
}

function extractHexCodes(md: string): ColorCandidate[] {
  const matches = md.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const seen = new Set<string>();
  const out: ColorCandidate[] = [];
  for (const raw of matches) {
    const hex = raw.toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    const [h, s, l] = hexToHsl(hex);
    out.push({ hex, h, s, l });
  }
  return out;
}

function isGreen(h: number): boolean {
  return h >= 90 && h < 160;
}
function isRed(h: number): boolean {
  return h < 20 || h >= 340;
}
function isYellowOrange(h: number): boolean {
  return h >= 25 && h < 60;
}

function buildPalette(candidates: ColorCandidate[]): Palette {
  const defaults: Palette = {
    primary: "#5B6CFF",
    secondary: "#FFB05A",
    accent: "#19C2A3",
    neutral: "#F3F4F6",
    success: "#22C55E",
    warning: "#F59E0B",
    danger: "#EF4444",
  };

  // Action-suitable colors: vivid, not status-coded
  const action = candidates
    .filter(
      (c) =>
        c.s > 35 &&
        c.l > 25 &&
        c.l < 75 &&
        !isGreen(c.h) &&
        !isYellowOrange(c.h) &&
        !isRed(c.h),
    )
    .sort((a, b) => b.s - a.s);

  const primary = action[0]?.hex ?? defaults.primary;
  const primaryHue = action[0]?.h ?? 0;

  // Secondary: next vivid color
  const secondary = action[1]?.hex ?? defaults.secondary;

  // Accent: vivid color with a different hue from primary (≥60° away), or any 3rd action color
  const accent =
    action.find((c) => Math.abs(c.h - primaryHue) > 60)?.hex ??
    action[2]?.hex ??
    defaults.accent;

  // Neutral: lightest near-grayscale
  const neutral =
    candidates
      .filter((c) => c.s < 15 && c.l > 90)
      .sort((a, b) => b.l - a.l)[0]?.hex ?? defaults.neutral;

  // Status colors by hue
  const success =
    candidates.find((c) => isGreen(c.h) && c.s > 30 && c.l > 30 && c.l < 75)?.hex ??
    defaults.success;
  const warning =
    candidates.find((c) => isYellowOrange(c.h) && c.s > 45 && c.l > 40)?.hex ??
    defaults.warning;
  const danger =
    candidates.find((c) => isRed(c.h) && c.s > 40 && c.l < 70)?.hex ?? defaults.danger;

  return { primary, secondary, accent, neutral, success, warning, danger };
}

// ──────────────────────────────────────────────────────────────────
// Typography parsing
// ──────────────────────────────────────────────────────────────────

const FONT_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /SF\s+Pro\s+(?:Display|Text)/i, name: "SF Pro Display" },
  { pattern: /\bInter\b/, name: "Inter" },
  { pattern: /\bSpace\s+Grotesk\b/i, name: "Space Grotesk" },
  { pattern: /\bIBM\s+Plex(?:\s+Sans|\s+Mono)?/i, name: "IBM Plex Sans" },
  { pattern: /\bDM\s+Sans\b/i, name: "DM Sans" },
  { pattern: /\bPoppins\b/, name: "Poppins" },
  { pattern: /\bMontserrat\b/, name: "Montserrat" },
  { pattern: /\bRoboto\b/, name: "Roboto" },
  { pattern: /\bHelvetica(?:\s+Neue)?/i, name: "Helvetica Neue" },
  { pattern: /\bSegoe\s+UI\b/i, name: "Segoe UI" },
  { pattern: /\bGeist\b/, name: "Geist" },
  { pattern: /\bSatoshi\b/, name: "Satoshi" },
];

function parseFontFamily(md: string): string | null {
  for (const { pattern, name } of FONT_PATTERNS) {
    if (pattern.test(md)) {
      const quoted = name.includes(" ") ? `'${name}'` : name;
      return `${quoted}, 'PingFang SC', system-ui, sans-serif`;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// Layout inference
// ──────────────────────────────────────────────────────────────────

function inferLayoutRecipe(
  appType: AppType,
): StyleResult["layout_recipe"] {
  switch (appType) {
    case "comparison":
      return "list-detail";
    case "pricing-page":
      return "form-heavy";
    default:
      return "dashboard-grid";
  }
}

// ──────────────────────────────────────────────────────────────────
// Network
// ──────────────────────────────────────────────────────────────────

async function fetchDesignMd(systemName: string): Promise<string | null> {
  const url = `${GH_RAW_BASE}/${systemName}/DESIGN.md`;
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

function pickSystem(appType: AppType): string {
  const candidates = DESIGN_SYSTEMS_BY_APP_TYPE[appType];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function tryOpenDesign(
  appType: AppType,
): Promise<StyleResult | null> {
  // Try up to 2 systems before falling back (in case one fails to parse)
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 2; attempt++) {
    let systemName = pickSystem(appType);
    let guard = 0;
    while (tried.has(systemName) && guard++ < 5) {
      systemName = pickSystem(appType);
    }
    tried.add(systemName);

    const md = await fetchDesignMd(systemName);
    if (!md) continue;

    const candidates = extractHexCodes(md);
    if (candidates.length < 3) continue;

    const palette = buildPalette(candidates);
    const font =
      parseFontFamily(md) ?? "Inter, 'PingFang SC', system-ui, sans-serif";

    return {
      palette,
      font_family: font,
      layout_recipe: inferLayoutRecipe(appType),
      source_url: `https://github.com/nexu-io/open-design/blob/main/design-systems/${systemName}/DESIGN.md`,
      source: "open-design",
      source_system: systemName,
    };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// Local fallback
// ──────────────────────────────────────────────────────────────────

async function loadLocalFallback(appType: AppType): Promise<StyleResult> {
  const candidates = [`${appType}.json`, "dashboard-grid.json"];
  for (const filename of candidates) {
    try {
      const text = await readFile(join(ASSETS_DIR, filename), "utf-8");
      const parsed = JSON.parse(text) as Omit<
        StyleResult,
        "source" | "source_system"
      >;
      return { ...parsed, source: "local-fallback" };
    } catch {
      /* try next */
    }
  }
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
    layout_recipe: inferLayoutRecipe(appType),
    source_url: "",
    source: "local-fallback",
  };
}

// ──────────────────────────────────────────────────────────────────
// MCP tool registration
// ──────────────────────────────────────────────────────────────────

export function registerFetchStyleTool(server: McpServer): void {
  server.tool(
    "fetch_style",
    "Fetch visual style (palette + typography + layout) for a generated app. Pulls a brand-grade DESIGN.md from nexu-io/open-design via raw GitHub (5s timeout), parses hex codes + font family + layout, and falls back to a curated local library if the fetch fails or parsing finds too few colors.",
    {
      app_type: z
        .enum(VALID_APP_TYPES)
        .describe("App archetype — CRM / calendar / billing / comparison / pricing-page / other"),
      description: z
        .string()
        .describe("Free-text app description (reserved for future search refinement)"),
    },
    async ({ app_type, description }) => {
      void description; // reserved for future use
      const result =
        (await tryOpenDesign(app_type)) ?? (await loadLocalFallback(app_type));
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

// ──────────────────────────────────────────────────────────────────
// Exported helpers for testing
// ──────────────────────────────────────────────────────────────────

export const __testing = {
  hexToHsl,
  extractHexCodes,
  buildPalette,
  parseFontFamily,
  DESIGN_SYSTEMS_BY_APP_TYPE,
};
