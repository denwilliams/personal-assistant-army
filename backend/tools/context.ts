import type { MemoryRepository } from "../repositories/MemoryRepository";
import type { SkillRepository } from "../repositories/SkillRepository";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import type { MqttRepository } from "../repositories/MqttRepository";
import type { MqttService } from "../services/MqttService";
import type { WorkflowEngine } from "../workflows/WorkflowEngine";

export type ToolStatusUpdate = (
  /** Message to display to the user as the status update */
  message: string,
  /** Similar to Slack Blocks - allows tools and agents to attach richer messages. Format TBD. */
  blocks?: unknown
) => void;

/**
 * Workflow-specific context available to tools during workflow execution.
 */
export interface WorkflowToolContext {
  workflowEngine: WorkflowEngine;
  executionId: number;
  currentStepId: string;
}

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

  // Workflow context (present when a workflow is active)
  workflow?: WorkflowToolContext;
}

/** Helper to extract AgentToolContext from tool execution options */
export function getContext(options: { experimental_context?: unknown }): AgentToolContext {
  return options.experimental_context as AgentToolContext;
}

/** Helper to extract workflow context from tool execution options, returns null if no active workflow */
export function getWorkflowContext(options: { experimental_context?: unknown }): WorkflowToolContext | null {
  const ctx = options.experimental_context as AgentToolContext;
  return ctx?.workflow ?? null;
}
