import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DB_PATH = join(homedir(), ".claw", "shared", "shared.db");

const widgetSchema = z.object({
  type: z.string(),
  title: z.string(),
  config: z.record(z.unknown()).default({}),
  data: z.array(z.unknown()).default([]),
  position: z.number().int().default(0),
});

function openDb(): Database.Database {
  // ensure dir exists
  mkdirSync(join(homedir(), ".claw", "shared"), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_modules (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📊',
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dashboard_widgets (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      widget_type TEXT NOT NULL,
      title TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      data TEXT DEFAULT '[]',
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export interface RegisterInput {
  agent_id: string;
  module_name: string;
  icon?: string;
  widgets: Array<z.infer<typeof widgetSchema>>;
}

/**
 * Underlying logic, callable from scripts/tests/MCP-tool wrapper.
 * Atomic: rolls back on any widget insert failure.
 */
export function registerDashboardModule(
  input: RegisterInput,
): { module_id: string; widgets_inserted: number } {
  const { agent_id, module_name, icon = "📊", widgets } = input;
  const db = openDb();
  const moduleId = uuidv4().slice(0, 8);

  const insertModule = db.prepare(
    "INSERT INTO dashboard_modules (id, agent_id, name, icon) VALUES (?, ?, ?, ?)",
  );
  const insertWidget = db.prepare(`
    INSERT INTO dashboard_widgets (id, module_id, widget_type, title, config, data, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertModule.run(moduleId, agent_id, module_name, icon);
    for (const w of widgets) {
      insertWidget.run(
        uuidv4().slice(0, 8),
        moduleId,
        w.type,
        w.title,
        JSON.stringify(w.config),
        JSON.stringify(w.data),
        w.position,
      );
    }
  });

  try {
    tx();
  } finally {
    db.close();
  }
  return { module_id: moduleId, widgets_inserted: widgets.length };
}

export function registerDashboardModuleTool(server: McpServer): void {
  server.tool(
    "register_dashboard_module",
    "Atomically register a new dashboard module and all its widgets in shared.db. Returns the module_id. Transactional: rolls back on any widget insert failure.",
    {
      agent_id: z.string().describe("Agent ID, e.g. vibe-customer-followup-x7k3pa"),
      module_name: z.string().describe("Display name of the module"),
      icon: z.string().default("📊").describe("Emoji icon"),
      widgets: z.array(widgetSchema).describe("List of widget configs"),
    },
    async (input) => {
      try {
        const result = registerDashboardModule(input);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "register_failed", reason: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/** Used by publish-and-hire for rollback on publish failure. */
export function deleteDashboardModule(moduleId: string): void {
  const db = openDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM dashboard_widgets WHERE module_id = ?").run(moduleId);
    db.prepare("DELETE FROM dashboard_modules WHERE id = ?").run(moduleId);
  });
  tx();
  db.close();
}
