import type { Session, AgentInputItem } from "@openai/agents";
import type { ConversationRepository } from "../repositories/ConversationRepository";

/**
 * Database-backed session implementation for OpenAI Agents SDK
 * Stores conversation history in the database via ConversationRepository
 */
export class DatabaseSession implements Session {
  private conversationId: number;
  private conversationRepository: ConversationRepository;

  constructor(conversationId: number, conversationRepository: ConversationRepository) {
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
    const messages = await this.conversationRepository.listMessages(this.conversationId);

    // Convert database messages to AgentInputItems
    let items: AgentInputItem[] = messages.map((msg) => ({
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
    }));

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
      await this.conversationRepository.addMessage({
        conversation_id: this.conversationId,
        role: item.role,
        content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
      });
    }
  }

  /**
   * Remove and return the most recent item from conversation history
   */
  async popItem(): Promise<AgentInputItem | undefined> {
    const messages = await this.conversationRepository.listMessages(this.conversationId);

    if (messages.length === 0) {
      return undefined;
    }

    const lastMessage = messages[messages.length - 1];

    // Delete the last message
    await this.conversationRepository.deleteMessage(lastMessage.id);

    // Return it as an AgentInputItem
    return {
      role: lastMessage.role as "user" | "assistant" | "system",
      content: lastMessage.content,
    };
  }

  /**
   * Clear all messages in this conversation
   */
  async clearSession(): Promise<void> {
    const messages = await this.conversationRepository.listMessages(this.conversationId);

    for (const message of messages) {
      await this.conversationRepository.deleteMessage(message.id);
    }
  }
}
