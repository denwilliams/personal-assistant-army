import type { ModelMessage } from "ai";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { Message } from "../types/models";

/**
 * Database-backed conversation history manager for Vercel AI SDK.
 * Converts between database messages and ModelMessage format.
 */
export class DatabaseSession {
  private conversationId: number;
  private conversationRepository: ConversationRepository;

  constructor(
    conversationId: number,
    conversationRepository: ConversationRepository
  ) {
    this.conversationId = conversationId;
    this.conversationRepository = conversationRepository;
  }

  /**
   * Load conversation history as ModelMessage array for Vercel AI SDK
   */
  async getMessages(): Promise<ModelMessage[]> {
    const messages = await this.conversationRepository.listMessages(
      this.conversationId
    );

    return messages
      .map((msg) => messageToCore(msg))
      .filter((m): m is ModelMessage => m !== null);
  }

  /**
   * Save a user message to the database
   */
  async addUserMessage(content: string): Promise<void> {
    await this.conversationRepository.addMessage({
      conversation_id: this.conversationId,
      role: "user",
      content,
      raw_data: { role: "user", content },
    });
  }

  /**
   * Save response messages from a Vercel AI SDK result.
   * Accepts the responseMessages from streamText/generateText results.
   */
  async saveResponseMessages(responseMessages: ModelMessage[]): Promise<void> {
    for (const msg of responseMessages) {
      let contentText = "";

      if (typeof msg.content === "string") {
        contentText = msg.content;
      } else if (Array.isArray(msg.content)) {
        contentText = msg.content
          .map((part: any) => {
            if (part.type === "text") return part.text;
            if (part.type === "tool-call") return `Tool call: ${part.toolName}`;
            if (part.type === "tool-result") return `Tool result: ${part.toolName}`;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      }

      await this.conversationRepository.addMessage({
        conversation_id: this.conversationId,
        role: msg.role === "tool" ? "assistant" : msg.role,
        content: contentText || "[non-text content]",
        raw_data: msg,
      });
    }
  }
}

function messageToCore(msg: Message): ModelMessage | null {
  // If we have raw_data saved in Vercel AI SDK format, use it directly
  if (msg.raw_data) {
    const raw = typeof msg.raw_data === "string"
      ? JSON.parse(msg.raw_data)
      : msg.raw_data;

    // Already a ModelMessage
    if (raw.role && raw.content !== undefined) {
      return raw as ModelMessage;
    }
  }

  // Fall back to simple conversion from database fields
  switch (msg.role) {
    case "user":
      return { role: "user", content: msg.content };
    case "assistant":
      return { role: "assistant", content: msg.content };
    case "system":
      return { role: "system", content: msg.content };
    default:
      return null;
  }
}
