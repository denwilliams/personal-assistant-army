import { describe, test, expect, mock } from "bun:test";
import { DatabaseSession } from "../backend/services/DatabaseSession";

describe("DatabaseSession", () => {
  test("getMessages converts simple DB messages to ModelMessage format", async () => {
    const mockRepo = {
      listMessages: mock(() => Promise.resolve([
        { id: 1, conversation_id: 1, role: "user", content: "Hello", created_at: new Date() },
        { id: 2, conversation_id: 1, role: "assistant", content: "Hi there!", created_at: new Date() },
      ])),
    } as any;

    const session = new DatabaseSession(1, mockRepo);
    const messages = await session.getMessages();

    expect(messages.length).toBe(2);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  test("getMessages uses raw_data when available", async () => {
    const rawMessage = { role: "assistant", content: [{ type: "text", text: "Hello" }] };
    const mockRepo = {
      listMessages: mock(() => Promise.resolve([
        { id: 1, conversation_id: 1, role: "assistant", content: "Hello", raw_data: rawMessage, created_at: new Date() },
      ])),
    } as any;

    const session = new DatabaseSession(1, mockRepo);
    const messages = await session.getMessages();

    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual(rawMessage);
  });

  test("addUserMessage saves message with raw_data", async () => {
    const addedMessages: any[] = [];
    const mockRepo = {
      addMessage: mock((msg: any) => {
        addedMessages.push(msg);
        return Promise.resolve();
      }),
    } as any;

    const session = new DatabaseSession(42, mockRepo);
    await session.addUserMessage("test message");

    expect(addedMessages.length).toBe(1);
    expect(addedMessages[0].conversation_id).toBe(42);
    expect(addedMessages[0].role).toBe("user");
    expect(addedMessages[0].content).toBe("test message");
    expect(addedMessages[0].raw_data).toEqual({ role: "user", content: "test message" });
  });

  test("saveResponseMessages extracts text content from string messages", async () => {
    const addedMessages: any[] = [];
    const mockRepo = {
      addMessage: mock((msg: any) => {
        addedMessages.push(msg);
        return Promise.resolve();
      }),
    } as any;

    const session = new DatabaseSession(1, mockRepo);
    await session.saveResponseMessages([
      { role: "assistant", content: "Hello world" } as any,
    ]);

    expect(addedMessages.length).toBe(1);
    expect(addedMessages[0].role).toBe("assistant");
    expect(addedMessages[0].content).toBe("Hello world");
  });

  test("saveResponseMessages maps tool role to assistant", async () => {
    const addedMessages: any[] = [];
    const mockRepo = {
      addMessage: mock((msg: any) => {
        addedMessages.push(msg);
        return Promise.resolve();
      }),
    } as any;

    const session = new DatabaseSession(1, mockRepo);
    await session.saveResponseMessages([
      { role: "tool", content: [{ type: "tool-result", toolName: "recall", result: "data" }] } as any,
    ]);

    expect(addedMessages.length).toBe(1);
    expect(addedMessages[0].role).toBe("assistant");
  });

  test("getMessages filters null results from unknown roles", async () => {
    const mockRepo = {
      listMessages: mock(() => Promise.resolve([
        { id: 1, conversation_id: 1, role: "user", content: "Hi", created_at: new Date() },
        { id: 2, conversation_id: 1, role: "function", content: "result", created_at: new Date() }, // unknown role
        { id: 3, conversation_id: 1, role: "assistant", content: "Hello", created_at: new Date() },
      ])),
    } as any;

    const session = new DatabaseSession(1, mockRepo);
    const messages = await session.getMessages();

    expect(messages.length).toBe(2); // function role filtered out
  });
});
