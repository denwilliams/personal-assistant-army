import { tool } from "@openai/agents";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import { z } from "zod";
import type { ToolContext } from "./context";

export function createNotifyTool<TContext extends ToolContext>(
  notificationRepository: NotificationRepository,
  userId: number,
  agentId: number,
  conversationId: number | null
) {
  return tool<typeof notifyParams, TContext>({
    name: "notify_user",
    description:
      "Send a notification to the user. Use when you have important findings, completed scheduled tasks, or urgent information. The notification will appear in their notification feed and optionally via email/webhook.",
    parameters: notifyParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Sending notification...");

      // Create the notification (always stored in web/DB)
      const notification = await notificationRepository.create({
        user_id: userId,
        agent_id: agentId,
        conversation_id: conversationId ?? undefined,
        message: params.message,
        urgency: params.urgency,
      });

      const channels = params.channels;

      // Queue external deliveries (email, webhook) - processed async by NotificationService
      for (const channel of channels) {
        if (channel === "web") continue; // Already stored in DB

        // Check if agent is muted for this channel
        const muted = await notificationRepository.isAgentMuted(
          userId,
          agentId,
          channel
        );
        if (muted) continue;

        await notificationRepository.createDelivery(notification.id, channel);
      }

      console.log(
        `Agent sent notification: ${params.message.substring(0, 50)} (channels=${channels.join(",")})`
      );

      return JSON.stringify({
        success: true,
        notification_id: notification.id,
        message: `Notification sent via: ${channels.join(", ")}`,
      });
    },
  });
}

const notifyParams = z.object({
  message: z.string().describe("The notification message"),
  urgency: z
    .enum(["low", "normal", "high"])
    .describe(
      "low = FYI, normal = should see soon, high = needs attention now"
    ),
  channels: z
    .array(z.enum(["web", "email", "webhook", "pushover"]))
    .describe(
      "Where to deliver the notification, e.g. ['web', 'pushover']"
    ),
});
