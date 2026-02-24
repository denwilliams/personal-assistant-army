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
      "Send a notification to the user. Use when you have important findings, completed scheduled tasks, or urgent information. Delivery channels (push, email, etc.) are handled automatically based on the user's preferences.",
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

      // Determine delivery channels from user settings
      const settings = await notificationRepository.getSettings(userId);
      const channels: ('email' | 'webhook' | 'pushover')[] = [];
      if (settings?.email_enabled && settings.notification_email) {
        channels.push("email");
      }
      if (settings?.webhook_urls?.length) {
        channels.push("webhook");
      }
      if (settings?.pushover_enabled && settings.pushover_user_key) {
        channels.push("pushover");
      }

      // Queue external deliveries - processed async by NotificationService
      for (const channel of channels) {
        const muted = await notificationRepository.isAgentMuted(
          userId,
          agentId,
          channel
        );
        if (muted) continue;

        await notificationRepository.createDelivery(notification.id, channel);
      }

      console.log(
        `Agent sent notification: ${params.message.substring(0, 50)} (channels=web${channels.length > 0 ? "," + channels.join(",") : ""})`
      );

      return JSON.stringify({
        success: true,
        notification_id: notification.id,
        message: "Notification sent",
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
});
