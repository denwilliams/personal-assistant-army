import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import type { MqttRepository } from "../repositories/MqttRepository";
import type { MqttService } from "../services/MqttService";
import { z } from "zod";
import type { ToolStatusUpdate } from "./context";

const MAX_SUBSCRIPTIONS_PER_USER = 50;

export function createMqttTools(
  mqttRepository: MqttRepository,
  mqttService: MqttService,
  userId: number,
  agentId: number,
  conversationId: number | null,
  updateStatus: ToolStatusUpdate
): Record<string, AiTool> {
  // ---------- mqtt_publish ----------
  const publishParams = z.object({
    topic: z.string().describe("MQTT topic to publish to (e.g., 'home/lights/living-room')"),
    payload: z.string().describe("Message payload to publish"),
    qos: z.number().describe("Quality of Service: 0 (at most once), 1 (at least once), 2 (exactly once). Default: 0"),
    retain: z.boolean().describe("Whether the broker should retain this message. Default: false"),
  });

  const mqtt_publish = tool({
    description: "Publish a message to an MQTT topic. Use this to send commands or data to IoT devices and services.",
    inputSchema: publishParams,
    execute: async (params) => {
      updateStatus(`Publishing to ${params.topic}...`);
      try {
        const qos = (params.qos ?? 0) as 0 | 1 | 2;
        await mqttService.publish(userId, params.topic, params.payload, qos, params.retain ?? false);
        return JSON.stringify({
          success: true,
          message: `Published to ${params.topic}`,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to publish",
        });
      }
    },
  });

  // ---------- mqtt_subscribe ----------
  const subscribeParams = z.object({
    topic: z.string().describe("MQTT topic pattern to subscribe to (supports + and # wildcards)"),
    prompt_template: z.string().describe(
      "Template for the prompt sent to this agent when a message arrives. Use {topic} and {payload} as placeholders. Example: 'An MQTT message arrived on {topic}: {payload}. Analyze and respond.'"
    ),
    qos: z.number().describe("Quality of Service: 0, 1, or 2. Default: 0"),
    conversation_mode: z.enum(["new", "continue"]).describe(
      "'new' creates a fresh conversation per message. 'continue' reuses the current conversation. Default: 'new'"
    ),
    rate_limit_max: z.number().describe("Maximum trigger executions within the rate limit window. Default: 5"),
    rate_limit_window_minutes: z.number().describe("Rate limit window in minutes. Default: 1"),
  });

  const mqtt_subscribe = tool({
    description:
      "Subscribe to an MQTT topic. When messages arrive, this agent will be triggered with the prompt template. Supports MQTT wildcards: '+' (single level) and '#' (multi-level).",
    inputSchema: subscribeParams,
    execute: async (params) => {
      updateStatus(`Subscribing to ${params.topic}...`);
      try {
        const count = await mqttRepository.countSubscriptionsByUser(userId);
        if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
          return JSON.stringify({
            error: `Subscription limit reached (${MAX_SUBSCRIPTIONS_PER_USER}). Unsubscribe from unused topics first.`,
          });
        }

        const existing = await mqttRepository.findSubscription(agentId, params.topic);
        if (existing) {
          return JSON.stringify({
            error: `Already subscribed to ${params.topic}. Unsubscribe first to change settings.`,
          });
        }

        const windowMs = (params.rate_limit_window_minutes ?? 1) * 60 * 1000;

        const sub = await mqttRepository.createSubscription({
          user_id: userId,
          agent_id: agentId,
          topic: params.topic,
          qos: params.qos ?? 0,
          prompt_template: params.prompt_template,
          conversation_mode: params.conversation_mode ?? "new",
          conversation_id: params.conversation_mode === "continue" && conversationId ? conversationId : undefined,
          rate_limit_window_ms: windowMs,
          rate_limit_max_triggers: params.rate_limit_max ?? 5,
        });

        await mqttService.refreshSubscriptions(userId);

        return JSON.stringify({
          success: true,
          subscription_id: sub.id,
          message: `Subscribed to ${params.topic} (rate limit: ${params.rate_limit_max ?? 5} per ${params.rate_limit_window_minutes ?? 1}min)`,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to subscribe",
        });
      }
    },
  });

  // ---------- mqtt_unsubscribe ----------
  const unsubscribeParams = z.object({
    topic: z.string().describe("MQTT topic to unsubscribe from"),
  });

  const mqtt_unsubscribe = tool({
    description: "Unsubscribe from an MQTT topic. Stops receiving messages on this topic.",
    inputSchema: unsubscribeParams,
    execute: async (params) => {
      updateStatus(`Unsubscribing from ${params.topic}...`);
      try {
        const existing = await mqttRepository.findSubscription(agentId, params.topic);
        if (!existing) {
          return JSON.stringify({ error: `Not subscribed to ${params.topic}` });
        }

        await mqttRepository.deleteSubscription(agentId, params.topic);
        await mqttService.refreshSubscriptions(userId);

        return JSON.stringify({
          success: true,
          message: `Unsubscribed from ${params.topic}`,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to unsubscribe",
        });
      }
    },
  });

  // ---------- mqtt_list_subscriptions ----------
  const listSubsParams = z.object({});

  const mqtt_list_subscriptions = tool({
    description: "List your active MQTT subscriptions.",
    inputSchema: listSubsParams,
    execute: async () => {
      updateStatus("Loading subscriptions...");
      try {
        const subs = await mqttRepository.listSubscriptionsByAgent(agentId);
        return JSON.stringify(
          subs.map((s) => ({
            id: s.id,
            topic: s.topic,
            qos: s.qos,
            prompt_template: s.prompt_template.substring(0, 100),
            conversation_mode: s.conversation_mode,
            rate_limit: `${s.rate_limit_max_triggers} per ${Number(s.rate_limit_window_ms) / 60000}min`,
            enabled: s.enabled,
          }))
        );
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to list subscriptions",
        });
      }
    },
  });

  // ---------- mqtt_get_recent ----------
  const getRecentParams = z.object({
    topic: z.string().describe("MQTT topic to get recent messages from"),
    limit: z.number().describe("Maximum number of messages to return (1-50). Default: 10"),
  });

  const mqtt_get_recent = tool({
    description: "Get recent messages from the MQTT message buffer for a specific topic. Messages are retained for 1 hour.",
    inputSchema: getRecentParams,
    execute: async (params) => {
      updateStatus(`Loading messages from ${params.topic}...`);
      try {
        const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
        const messages = await mqttRepository.getRecentMessages(userId, params.topic, limit);

        return JSON.stringify(
          messages.map((m) => ({
            topic: m.topic,
            payload: m.payload,
            qos: m.qos,
            retained: m.retained,
            received_at: new Date(Number(m.received_at)).toISOString(),
          }))
        );
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to get messages",
        });
      }
    },
  });

  return { mqtt_publish, mqtt_subscribe, mqtt_unsubscribe, mqtt_list_subscriptions, mqtt_get_recent };
}
