import { describe, test, expect } from "bun:test";
import { resolveModel, getProviderFromModel, DEFAULT_MODEL, AVAILABLE_MODELS } from "../backend/services/ModelResolver";

describe("ModelResolver", () => {
  test("DEFAULT_MODEL is a valid format", () => {
    expect(DEFAULT_MODEL).toContain(":");
    expect(getProviderFromModel(DEFAULT_MODEL)).toBe("openai");
  });

  test("getProviderFromModel extracts provider correctly", () => {
    expect(getProviderFromModel("openai:gpt-4o")).toBe("openai");
    expect(getProviderFromModel("anthropic:claude-sonnet-4-20250514")).toBe("anthropic");
    expect(getProviderFromModel("google:gemini-2.0-flash")).toBe("google");
  });

  test("getProviderFromModel defaults to openai for invalid format", () => {
    expect(getProviderFromModel("gpt-4o")).toBe("openai");
  });

  test("resolveModel throws for invalid format", () => {
    expect(() => resolveModel("no-colon", {})).toThrow("Invalid model format");
  });

  test("resolveModel throws for unknown provider", () => {
    expect(() => resolveModel("unknown:model", {})).toThrow("Unknown model provider");
  });

  test("resolveModel throws when OpenAI key is missing", () => {
    expect(() => resolveModel("openai:gpt-4o", {})).toThrow("OpenAI API key not configured");
  });

  test("resolveModel throws when Anthropic key is missing", () => {
    expect(() => resolveModel("anthropic:claude-sonnet-4-20250514", {})).toThrow("Anthropic API key not configured");
  });

  test("resolveModel throws when Google key is missing", () => {
    expect(() => resolveModel("google:gemini-2.0-flash", {})).toThrow("Google AI API key not configured");
  });

  test("resolveModel returns a model for OpenAI with key", () => {
    const model = resolveModel("openai:gpt-4o", { openai: "sk-test" });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
  });

  test("resolveModel returns a model for Anthropic with key", () => {
    const model = resolveModel("anthropic:claude-sonnet-4-20250514", { anthropic: "sk-ant-test" });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  test("resolveModel returns a model for Google with key", () => {
    const model = resolveModel("google:gemini-2.0-flash", { google: "test-key" });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gemini-2.0-flash");
  });

  test("AVAILABLE_MODELS all have valid format", () => {
    for (const m of AVAILABLE_MODELS) {
      expect(m.id).toContain(":");
      expect(["openai", "anthropic", "google"]).toContain(m.provider);
      expect(m.name.length).toBeGreaterThan(0);
    }
  });
});
