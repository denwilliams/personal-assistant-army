import type { MemoryRepository } from "../repositories/MemoryRepository";
import type { SkillRepository } from "../repositories/SkillRepository";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import type { MqttRepository } from "../repositories/MqttRepository";
import type { MqttService } from "../services/MqttService";

export type ToolStatusUpdate = (
  /** Message to display to the user as the status update */
  message: string,
  /** Similar to Slack Blocks - allows tools and agents to attach richer messages. Format TBD. */
  blocks?: unknown
) => void;

/**
 * Shared context passed to all tools via experimental_context on ToolLoopAgent.
 * Tools access this at execution time instead of capturing dependencies in closures.
 */
export interface AgentToolContext {
  updateStatus: ToolStatusUpdate;
  userId: number;
  agentId: number;
  conversationId: number | null;
  timezone: string;

  // Repositories
  memoryRepository: MemoryRepository;
  skillRepository: SkillRepository;
  scheduleRepository: ScheduleRepository;
  notificationRepository: NotificationRepository;
  mqttRepository: MqttRepository | null;
  mqttService: MqttService | null;

  // Optional capabilities
  generateEmbedding?: (text: string) => Promise<number[]>;
  googleSearchApiKey?: string;
  googleSearchEngineId?: string;
}

/** Helper to extract AgentToolContext from tool execution options */
export function getContext(options: { experimental_context?: unknown }): AgentToolContext {
  return options.experimental_context as AgentToolContext;
}
