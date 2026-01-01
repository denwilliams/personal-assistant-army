import type {
  Session,
  AgentInputItem,
  SystemMessageItem,
  AssistantMessageItem,
  UserMessageItem,
} from "@openai/agents";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { Message } from "../types/models";

/**
 * Database-backed session implementation for OpenAI Agents SDK
 * Stores conversation history in the database via ConversationRepository
 */
export class DatabaseSession implements Session {
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
   * Return the session identifier (our conversation ID as a string)
   */
  async getSessionId(): Promise<string> {
    return this.conversationId.toString();
  }

  /**
   * Retrieve conversation history as AgentInputItems
   * @param limit - Maximum number of items to return (most recent)
   */
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const messages = await this.conversationRepository.listMessages(
      this.conversationId
    );

    // Convert database messages to AgentInputItems
    // Use raw_data if available, otherwise fall back to simple structure
    let items: AgentInputItem[] = messages.map(messageToAgentInputItem);

    // Apply limit if specified (most recent items)
    if (limit !== undefined && limit > 0) {
      items = items.slice(-limit);
    }

    return items;
  }

  /**
   * Append new items to the conversation history
   * @param items - Items to add to the session
   */
  async addItems(items: AgentInputItem[]): Promise<void> {
    for (const item of items) {
      // Extract text content for the content field (for display/search)
      let contentText = "";

      // Handle different AgentInputItem types
      if ("content" in item) {
        if (typeof item.content === "string") {
          contentText = item.content;
        } else if (Array.isArray(item.content)) {
          // Extract text from content parts
          contentText = item.content
            .filter(
              (part: any) => part.type === "text" || part.type === "input_text"
            )
            .map((part: any) => part.text)
            .join("\n");
        }
      } else if ("type" in item && item.type === "hosted_tool_call") {
        contentText = `Tool call: ${item.name}`;
      }

      await this.conversationRepository.addMessage({
        conversation_id: this.conversationId,
        role: "role" in item ? item.role : "assistant",
        content: contentText || "[non-text content]",
        raw_data: item, // Store the full item structure
      });
    }
  }

  /**
   * Remove and return the most recent item from conversation history
   */
  async popItem(): Promise<AgentInputItem | undefined> {
    const messages = await this.conversationRepository.listMessages(
      this.conversationId
    );

    if (messages.length === 0) {
      return undefined;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return undefined;
    }

    // Delete the last message
    await this.conversationRepository.deleteMessage(lastMessage.id);

    return messageToAgentInputItem(lastMessage);
  }

  /**
   * Clear all messages in this conversation
   */
  async clearSession(): Promise<void> {
    await this.conversationRepository.deleteAllMessages(this.conversationId);
  }
}

function messageToAgentInputItem(msg: Message): AgentInputItem {
  if (msg.raw_data) {
    if (typeof msg.raw_data === "string") {
      return JSON.parse(msg.raw_data) as AgentInputItem;
    }

    return msg.raw_data as AgentInputItem;
  }

  throw new Error(`Unknown message role: ${msg.role}`);
}
