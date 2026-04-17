import type { BunRequest } from "bun";
import type { UserRepository } from "../repositories/UserRepository";
import type { TeamRepository } from "../repositories/TeamRepository";
import type { User } from "../types/models";
import { decrypt } from "../utils/encryption";

interface OpenWebUiHandlerDependencies {
  userRepository: UserRepository;
  teamRepository: TeamRepository | null;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me",
  "live.com", "msn.com", "mail.com", "ymail.com", "googlemail.com",
]);

function getUserDomain(email: string): string {
  return email.split("@")[1] ?? "";
}

function isPersonalDomain(domain: string): boolean {
  if (!domain || domain === "localhost") return true;
  if (domain.startsWith("demo-")) return true;
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

interface OpenWebUiModel {
  id: string;
  name: string;
}

/**
 * Probe an OpenWebUI instance for the list of available models.
 * OpenWebUI exposes an OpenAI-compatible catalogue at `/api/models`.
 */
async function fetchOpenWebUiModels(url: string, apiKey: string): Promise<OpenWebUiModel[]> {
  const base = url.replace(/\/+$/, "");
  const target = `${base}/api/models`;
  console.log(`[openwebui] Fetching models from ${target}`);

  let res: Response;
  try {
    res = await fetch(target, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[openwebui] Fetch to ${target} failed:`, err);
    throw new Error(`Failed to reach OpenWebUI at ${target}: ${message}`);
  }

  if (!res.ok) {
    throw new Error(`OpenWebUI returned HTTP ${res.status}: ${res.statusText}`);
  }
  const body = (await res.json()) as unknown;
  // OpenWebUI returns { data: [{ id, name?, ... }] } (OpenAI-compatible shape).
  const data = (body as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response from OpenWebUI /api/models");
  }
  return data
    .filter((m): m is { id: string; name?: string } =>
      typeof m === "object" && m !== null && typeof (m as any).id === "string"
    )
    .map((m) => ({ id: m.id, name: m.name ?? m.id }));
}

export function createOpenWebUiHandlers(deps: OpenWebUiHandlerDependencies) {
  /**
   * GET /api/user/openwebui/models
   * Returns the list of models exposed by the user's (or team's) OpenWebUI instance.
   */
  const listModels = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") === "team" ? "team" : "personal";

    let baseUrl: string | undefined;
    let apiKey: string | undefined;

    if (scope === "team") {
      if (!deps.teamRepository) {
        return Response.json({ error: "Team settings not available" }, { status: 400 });
      }
      const domain = getUserDomain(auth.user.email);
      if (isPersonalDomain(domain)) {
        return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
      }
      const settings = await deps.teamRepository.getSettings(domain);
      baseUrl = settings?.openwebui_url ?? undefined;
      if (settings?.openwebui_api_key) {
        apiKey = await decrypt(settings.openwebui_api_key, deps.encryptionSecret);
      }
    } else {
      baseUrl = auth.user.openwebui_url ?? undefined;
      if (auth.user.openwebui_api_key) {
        apiKey = await decrypt(auth.user.openwebui_api_key, deps.encryptionSecret);
      }
    }

    if (!baseUrl || !apiKey) {
      return Response.json(
        { error: "OpenWebUI URL and API key must be configured before listing models." },
        { status: 400 }
      );
    }

    try {
      const models = await fetchOpenWebUiModels(baseUrl, apiKey);
      return Response.json({
        models: models.map((m) => ({
          id: `openwebui:${m.id}`,
          name: m.name,
          provider: "openwebui",
        })),
      });
    } catch (err) {
      console.error("[openwebui] listModels error:", err);
      const message = err instanceof Error ? err.message : "Failed to reach OpenWebUI";
      return Response.json({ error: message }, { status: 502 });
    }
  };

  return { listModels };
}
