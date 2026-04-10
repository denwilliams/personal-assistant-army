import { describe, test, expect } from "bun:test";
import { createMemoryTools } from "../backend/tools/memoryTools";
import { createSkillTools } from "../backend/tools/skillTools";
import { createScheduleTools } from "../backend/tools/scheduleTool";
import { createNotifyTool } from "../backend/tools/notifyTool";
import { createWebSearchTool } from "../backend/tools/webSearchTool";
import { createUrlTool } from "../backend/tools/urlTool";

const noopStatus = () => {};

describe("Tool factories return correct tool names", () => {
  test("createMemoryTools returns expected tool names", () => {
    const mockMemoryRepo = {} as any;
    const tools = createMemoryTools(mockMemoryRepo, 1, noopStatus);
    const names = Object.keys(tools);
    expect(names).toContain("remember");
    expect(names).toContain("recall");
    expect(names).toContain("forget");
    expect(names).toContain("promote_memory");
    expect(names).toContain("demote_memory");
    expect(names.length).toBe(5);
  });

  test("createSkillTools returns expected tool names", () => {
    const mockSkillRepo = {} as any;
    const tools = createSkillTools(mockSkillRepo, 1, 1, noopStatus);
    const names = Object.keys(tools);
    expect(names).toContain("load_skill");
    expect(names).toContain("create_skill");
    expect(names).toContain("update_skill");
    expect(names).toContain("delete_skill");
    expect(names).toContain("list_skills");
    expect(names.length).toBe(5);
  });

  test("createScheduleTools returns expected tool names", () => {
    const mockScheduleRepo = {} as any;
    const tools = createScheduleTools(mockScheduleRepo, 1, 1, null, "UTC", noopStatus);
    const names = Object.keys(tools);
    expect(names).toContain("schedule_prompt");
    expect(names).toContain("list_schedules");
    expect(names).toContain("cancel_schedule");
    expect(names.length).toBe(3);
  });

  test("createNotifyTool returns expected tool names", () => {
    const mockNotifyRepo = {} as any;
    const tools = createNotifyTool(mockNotifyRepo, 1, 1, null, noopStatus);
    const names = Object.keys(tools);
    expect(names).toContain("notify_user");
    expect(names.length).toBe(1);
  });

  test("createWebSearchTool returns expected tool names", () => {
    const tools = createWebSearchTool("fake-key", "fake-cx", noopStatus);
    const names = Object.keys(tools);
    expect(names).toContain("web_search");
    expect(names.length).toBe(1);
  });

  test("createUrlTool returns tool with sanitized name", () => {
    const tools = createUrlTool(
      { id: 1, user_id: 1, name: "My API Tool", url: "https://example.com", method: "GET", headers: null, created_at: new Date(), updated_at: new Date() },
      noopStatus
    );
    const names = Object.keys(tools);
    expect(names.length).toBe(1);
    expect(names[0]).toBe("my_api_tool");
  });
});

describe("Tools have descriptions and inputSchemas", () => {
  test("memory tools have descriptions", () => {
    const tools = createMemoryTools({} as any, 1, noopStatus);
    for (const [name, tool] of Object.entries(tools)) {
      expect((tool as any).description).toBeTruthy();
      expect((tool as any).inputSchema).toBeDefined();
    }
  });

  test("web search tool has description", () => {
    const tools = createWebSearchTool("key", "cx", noopStatus);
    const t = tools.web_search as any;
    expect(t.description).toContain("Search the web");
    expect(t.inputSchema).toBeDefined();
  });
});
