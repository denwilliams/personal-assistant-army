import type { BunRequest } from "bun";
import { generateText } from "ai";
import type { User } from "../types/models";
import type { UserRepository } from "../repositories/UserRepository";
import type { TeamRepository } from "../repositories/TeamRepository";
import { decrypt } from "../utils/encryption";
import { resolveModel, DEFAULT_MODEL, type ApiKeys } from "../services/ModelResolver";
import { parseWorkflow, WorkflowParseError } from "../workflows/parser";

interface WorkflowBuilderDependencies {
  userRepository: UserRepository;
  teamRepository: TeamRepository | null;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

interface GenerateRequest {
  description: string;
  current_yaml?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

function getDomain(email: string): string {
  return email.split("@")[1] || "";
}

async function buildApiKeys(user: User, encryptionSecret: string): Promise<ApiKeys> {
  const keys: ApiKeys = {};
  if (user.openai_api_key) {
    keys.openai = await decrypt(user.openai_api_key, encryptionSecret);
  }
  if (user.anthropic_api_key) {
    keys.anthropic = await decrypt(user.anthropic_api_key, encryptionSecret);
  }
  if (user.google_ai_api_key) {
    keys.google = await decrypt(user.google_ai_api_key, encryptionSecret);
  }
  if (user.openwebui_url) {
    keys.openwebui_url = user.openwebui_url;
  }
  if (user.openwebui_api_key) {
    keys.openwebui_key = await decrypt(user.openwebui_api_key, encryptionSecret);
  }
  return keys;
}

function hasAnyProviderCreds(keys: ApiKeys): boolean {
  return !!(
    keys.openai ||
    keys.anthropic ||
    keys.google ||
    (keys.openwebui_url && keys.openwebui_key)
  );
}

/**
 * System prompt that teaches the LLM the full workflow YAML schema and the
 * conventions it should follow when generating one from a natural-language
 * description.
 */
const SYSTEM_PROMPT = `You are a Workflow Builder Agent. Your job is to convert natural-language descriptions of a process into a valid YAML workflow definition for the Personal Assistant Army platform.

## Output contract

Respond with ONLY a fenced code block containing the YAML, optionally preceded by a brief (1-3 sentence) plain-text summary of what you built. Do NOT include any other commentary, preambles, or trailing explanations.

Format:
<short summary sentence>
\`\`\`yaml
<the workflow YAML>
\`\`\`

## YAML schema

Top-level fields:
- name (string, required): human-readable workflow name
- description (string, required): what the workflow accomplishes
- version (string, required): semver, start at "1.0.0"
- tags (string[], optional): categorization tags
- timeout_minutes (number, optional, default 30): max wall-clock time
- steps (array, required, non-empty): ordered list of steps

Each step has:
- id (string, required): snake_case identifier, unique within the workflow
- name (string, required): human-readable step name
- description (string, required): instructions for the agent executing this step
- required_facts (array, required): facts the agent must collect
- allowed_tools (string | string[], required): "conversation", "any", or an array of specific tool names
- gate (object, required): conditions that must pass before advancing

Each fact has:
- name (string, required): snake_case identifier, unique within the step
- type: "string" | "number" | "boolean" | "date" | "enum" | "list"
- description (string, required): what this fact represents
- enum_values (string[], required when type is "enum")
- ask (string, optional): suggested phrasing for asking the user
- default (any, optional): default value if the user declines

Each gate has:
- conditions (array, non-empty): all must pass for the gate to open
- on_fail: "retry" (default) | "abort" | "skip"

Each condition has:
- fact (string, required): fact name for the current step, or "<step_id>.<fact_name>" for cross-step references
- operator: "exists" | "not_exists" | "equals" | "not_equals" | "in" | "not_in" | "contains" | "matches" | "gt" | "gte" | "lt" | "lte" | "length_gt" | "length_gte" | "length_lt" | "length_lte" | "is_true" | "is_false"
- value: required for every operator EXCEPT exists/not_exists/is_true/is_false
- message (string, optional): human-readable failure message

## Authoring conventions

- Keep workflows focused. Usually 2-5 steps.
- First step is typically a "collect information" step using allowed_tools: conversation.
- Use specific tool names in allowed_tools when the step needs a non-conversational action (e.g. calendar_check_availability, notify). It's fine to list "conversation" alongside tools.
- Each required_fact should have a gate condition covering it so the workflow cannot advance with missing data.
- Use the "matches" operator with a regex string for format validation (e.g., emails).
- Always quote the version string.
- Use snake_case for all ids and fact names.
- When refining an existing workflow, preserve step ids/names that still apply and bump the version (e.g. 1.0.0 -> 1.1.0).`;

function buildUserPrompt(body: GenerateRequest): string {
  const sections: string[] = [];

  if (body.current_yaml && body.current_yaml.trim()) {
    sections.push(
      `The user is refining an existing workflow. Here is the current YAML:\n\n\`\`\`yaml\n${body.current_yaml.trim()}\n\`\`\``
    );
  }

  if (body.history && body.history.length > 0) {
    const formattedHistory = body.history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
      .join("\n\n");
    sections.push(`Prior conversation:\n\n${formattedHistory}`);
  }

  sections.push(`Latest request from the user:\n\n${body.description.trim()}`);
  sections.push(
    body.current_yaml
      ? "Return the updated YAML workflow, incorporating the user's feedback."
      : "Return a YAML workflow that matches the user's description."
  );

  return sections.join("\n\n---\n\n");
}

/**
 * Extracts YAML content from the model response. Accepts either a fenced
 * ```yaml block or (as a fallback) the entire response body.
 */
function extractYaml(text: string): { yaml: string; message: string } {
  const fenceMatch = text.match(/```(?:yaml|yml)?\s*\n([\s\S]*?)```/i);
  if (fenceMatch) {
    const yaml = (fenceMatch[1] || "").trim();
    const before = text.slice(0, fenceMatch.index).trim();
    const after = text.slice((fenceMatch.index || 0) + fenceMatch[0].length).trim();
    const message = [before, after].filter(Boolean).join("\n\n").trim();
    return { yaml, message };
  }

  // No fence — assume the whole response is YAML if it has a "name:" line.
  if (/^\s*name\s*:/m.test(text)) {
    return { yaml: text.trim(), message: "" };
  }

  return { yaml: "", message: text.trim() };
}

export function createWorkflowBuilderHandlers(deps: WorkflowBuilderDependencies) {
  const generate = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: GenerateRequest;
    try {
      body = (await req.json()) as GenerateRequest;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.description || !body.description.trim()) {
      return new Response(
        JSON.stringify({ error: "description is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Assemble API keys — personal keys, falling back to the user's team when
    // the user hasn't configured any.
    let apiKeys = await buildApiKeys(auth.user, deps.encryptionSecret);
    if (!hasAnyProviderCreds(apiKeys) && deps.teamRepository) {
      const domain = getDomain(auth.user.email);
      if (domain) {
        const teamSettings = await deps.teamRepository.getSettings(domain);
        if (teamSettings?.openai_api_key) {
          apiKeys.openai = await decrypt(teamSettings.openai_api_key, deps.encryptionSecret);
        }
        if (teamSettings?.anthropic_api_key) {
          apiKeys.anthropic = await decrypt(teamSettings.anthropic_api_key, deps.encryptionSecret);
        }
        if (teamSettings?.google_ai_api_key) {
          apiKeys.google = await decrypt(teamSettings.google_ai_api_key, deps.encryptionSecret);
        }
        if (teamSettings?.openwebui_url) {
          apiKeys.openwebui_url = teamSettings.openwebui_url;
        }
        if (teamSettings?.openwebui_api_key) {
          apiKeys.openwebui_key = await decrypt(teamSettings.openwebui_api_key, deps.encryptionSecret);
        }
      }
    }

    if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
      return new Response(
        JSON.stringify({
          error:
            "No API keys configured. Add an OpenAI, Anthropic, or Google AI API key in your profile to use the workflow builder.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Prefer whichever provider the user has a key for, defaulting to OpenAI.
    const modelString = apiKeys.openai
      ? DEFAULT_MODEL
      : apiKeys.anthropic
        ? "anthropic:claude-sonnet-4-20250514"
        : "google:gemini-2.5-flash-preview-04-17";

    let model;
    try {
      model = resolveModel(modelString, apiKeys);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to resolve model",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const userPrompt = buildUserPrompt(body);

    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        maxOutputTokens: 2500,
      });

      const { yaml, message } = extractYaml(result.text);

      if (!yaml) {
        return Response.json({
          yaml: "",
          message: message || result.text,
          valid: false,
          validation_error:
            "The model did not return a YAML block. Try rephrasing the request.",
        });
      }

      // Validate the generated YAML so the client can show status immediately.
      let valid = false;
      let validationError: string | undefined;
      let validationPath: string | undefined;
      try {
        parseWorkflow(yaml);
        valid = true;
      } catch (err) {
        if (err instanceof WorkflowParseError) {
          validationError = err.message;
          validationPath = err.path;
        } else {
          validationError =
            err instanceof Error ? err.message : "Unknown validation error";
        }
      }

      return Response.json({
        yaml,
        message,
        valid,
        validation_error: validationError,
        validation_path: validationPath,
        model: modelString,
      });
    } catch (err) {
      console.error("Workflow builder generation error:", err);
      return new Response(
        JSON.stringify({
          error:
            err instanceof Error ? err.message : "Failed to generate workflow",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  };

  return { generate };
}
