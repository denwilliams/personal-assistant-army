import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";
import type { LanguageModel } from "ai";

export interface ApiKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
  ollama_url?: string;
}


/**
 * Parse a model string like "openai:gpt-4.1-mini" into a Vercel AI SDK model instance.
 * Supported providers: openai, anthropic, google, ollama
 */
export function resolveModel(
  modelString: string,
  apiKeys: ApiKeys
): LanguageModel {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid model format: "${modelString}". Expected "provider:model-id" (e.g., "openai:gpt-4.1-mini")`
    );
  }

  const provider = modelString.slice(0, colonIndex);
  const modelId = modelString.slice(colonIndex + 1);

  switch (provider) {
    case "openai": {
      if (!apiKeys.openai) {
        throw new Error(
          "OpenAI API key not configured. Please add it in your profile."
        );
      }
      const openai = createOpenAI({ apiKey: apiKeys.openai });
      return openai(modelId);
    }
    case "anthropic": {
      if (!apiKeys.anthropic) {
        throw new Error(
          "Anthropic API key not configured. Please add it in your profile."
        );
      }
      const anthropic = createAnthropic({ apiKey: apiKeys.anthropic });
      return anthropic(modelId);
    }
    case "google": {
      if (!apiKeys.google) {
        throw new Error(
          "Google AI API key not configured. Please add it in your profile."
        );
      }
      const google = createGoogleGenerativeAI({ apiKey: apiKeys.google });
      return google(modelId);
    }
    case "ollama": {
      if (!apiKeys.ollama_url) {
        throw new Error(
          "Ollama URL not configured. Please add it in your profile."
        );
      }
      const ollama = createOllama({
        baseURL: apiKeys.ollama_url,
      });
      return ollama(modelId);
    }
    default:
      throw new Error(`Unknown model provider: "${provider}"`);
  }
}

/**
 * Determine which API key provider is needed for a model string
 */
export function getProviderFromModel(modelString: string): string {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) return "openai"; // default
  return modelString.slice(0, colonIndex);
}

/** Default model used for new agents */
export const DEFAULT_MODEL = "openai:gpt-4.1-mini";

/** Available models for the UI */
export const AVAILABLE_MODELS = [
  // OpenAI
  { id: "openai:o3", name: "o3", provider: "openai" },
  { id: "openai:o3-mini", name: "o3 Mini", provider: "openai" },
  { id: "openai:o4-mini", name: "o4 Mini", provider: "openai" },
  { id: "openai:gpt-4.1", name: "GPT-4.1", provider: "openai" },
  { id: "openai:gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai" },
  { id: "openai:gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "openai" },
  { id: "openai:gpt-4o", name: "GPT-4o", provider: "openai" },
  { id: "openai:gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
  // Anthropic
  { id: "anthropic:claude-opus-4-20250514", name: "Claude Opus 4", provider: "anthropic" },
  { id: "anthropic:claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic" },
  { id: "anthropic:claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
  // Google
  { id: "google:gemini-2.5-pro-preview-05-06", name: "Gemini 2.5 Pro", provider: "google" },
  { id: "google:gemini-2.5-flash-preview-04-17", name: "Gemini 2.5 Flash", provider: "google" },
  { id: "google:gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google" },
];
