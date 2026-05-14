// Quick smoke test for fetch-style parsing.
// Usage: npx tsx tests/fetch-style.test.ts
//
// Fetches a few real DESIGN.md files from nexu-io/open-design,
// runs the parsers, prints the resulting palettes. No assertion
// framework — just visual verification that the output looks
// reasonable.

import { __testing } from "../src/tools/fetch-style.js";

const { extractHexCodes, buildPalette, parseFontFamily } = __testing;

const SYSTEMS_TO_TEST = [
  "apple",
  "stripe",
  "linear-app",
  "notion",
  "airbnb",
  "cohere",
  "vercel",
  "cal",
  "canva",
  "clean",
  "framer",
  "coinbase",
];

async function fetchAndParse(systemName: string): Promise<void> {
  const url = `https://raw.githubusercontent.com/nexu-io/open-design/main/design-systems/${systemName}/DESIGN.md`;
  process.stdout.write(`\n── ${systemName} ──\n`);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "vibe-code-builder-skill-test/0.1" },
    });
    if (!res.ok) {
      console.log(`  HTTP ${res.status}`);
      return;
    }
    const md = await res.text();
    const candidates = extractHexCodes(md);
    const palette = buildPalette(candidates);
    const font = parseFontFamily(md);
    console.log(`  hex codes found: ${candidates.length}`);
    console.log(`  palette:`);
    for (const [role, hex] of Object.entries(palette)) {
      console.log(`    ${role.padEnd(10)} ${hex}`);
    }
    console.log(`  font: ${font ?? "(none detected)"}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ERROR ${msg}`);
  }
}

(async () => {
  for (const name of SYSTEMS_TO_TEST) {
    await fetchAndParse(name);
  }
})();
