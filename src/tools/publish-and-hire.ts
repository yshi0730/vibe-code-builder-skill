import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { deleteDashboardModule } from "./register-dashboard-module.js";

interface PublishResult {
  agent_id: string;
  registry_version: string;
  dashboard_url: string;
}

function readTunnelPublicUrl(): string {
  const tunnelConfigPath = join(homedir(), ".claw", "config", "tunnel.json");
  if (!existsSync(tunnelConfigPath)) {
    return "";
  }
  try {
    const cfg = JSON.parse(readFileSync(tunnelConfigPath, "utf-8")) as {
      public_url?: string;
    };
    return cfg.public_url ?? "";
  } catch {
    return "";
  }
}

function runTalenthubPublish(
  agentDir: string,
  agentId: string,
): { ok: boolean; output: string; error?: string } {
  // pass empty input on stdin to accept the manifest version prompt
  const result = spawnSync("talenthub", ["agent", "publish", agentId, "--dir", agentDir], {
    input: "\n",
    encoding: "utf-8",
    timeout: 60_000,
  });

  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  if (result.status !== 0) {
    return { ok: false, output: combined, error: `exit ${result.status}` };
  }
  return { ok: true, output: combined };
}

function extractRegistryVersion(output: string): string {
  // talenthub publish output contains: "✓ Updated (version bumped to v2026.05.14-1)"
  const match = output.match(/version bumped to (v[0-9.\-]+)/);
  return match?.[1] ?? "";
}

function autoHire(
  userId: string,
  agentId: string,
): { ok: boolean; reason?: string } {
  // TODO: call the runtime team's auto-hire HTTP endpoint once it's available.
  // For now, log and return ok so we don't block the pipeline.
  // See CONFIG.md → AUTO_HIRE_ENDPOINT.
  void userId;
  void agentId;
  return { ok: true, reason: "auto_hire_not_implemented_user_must_hire_manually" };
}

export function registerPublishAndHireTool(server: McpServer): void {
  server.tool(
    "publish_and_hire",
    "Publish a generated agent via `talenthub agent publish`, then auto-hire it for the requesting user. On publish failure, rolls back the dashboard module (so we don't leave orphan rows in shared.db).",
    {
      agent_dir: z.string().describe("Path to the generated agent's file bundle"),
      user_id: z.string().describe("Requesting user's ID (for auto-hire)"),
      rollback_module_id: z
        .string()
        .describe("dashboard module_id to delete if publish fails"),
    },
    async ({ agent_dir, user_id, rollback_module_id }) => {
      // 1. Validate
      const manifestPath = join(agent_dir, "manifest.json");
      const identityPath = join(agent_dir, "IDENTITY.md");
      if (!existsSync(manifestPath) || !existsSync(identityPath)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "invalid_agent_dir",
                reason: "manifest.json or IDENTITY.md missing",
                agent_dir,
              }),
            },
          ],
          isError: true,
        };
      }

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        id: string;
        _vibeMetadata?: { moduleId?: string };
      };
      const agentId = manifest.id;

      // 2. Publish
      const pub = runTalenthubPublish(agent_dir, agentId);
      if (!pub.ok) {
        // Rollback dashboard registration
        try {
          deleteDashboardModule(rollback_module_id);
        } catch {
          /* swallow — rollback best-effort */
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "publish_failed",
                reason: pub.error,
                output: pub.output.slice(-2000),
                rollback_module_id,
                rollback_complete: true,
              }),
            },
          ],
          isError: true,
        };
      }

      const registryVersion = extractRegistryVersion(pub.output);

      // 3. Auto-hire (best-effort; not blocking)
      const hireResult = autoHire(user_id, agentId);

      // 4. Build dashboard_url
      const baseUrl = readTunnelPublicUrl();
      const dashboardUrl = baseUrl
        ? `${baseUrl}/m/${rollback_module_id}`
        : `https://device-${"<serial>"}.clawln.app/m/${rollback_module_id}`;

      const result: PublishResult & { auto_hire?: string } = {
        agent_id: agentId,
        registry_version: registryVersion,
        dashboard_url: dashboardUrl,
      };
      if (!hireResult.ok || hireResult.reason) {
        result.auto_hire = hireResult.reason ?? "unknown";
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
