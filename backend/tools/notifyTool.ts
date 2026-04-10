import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import { z } from "zod";
import type { ToolStatusUpdate } from "./context";

export function createNotifyTool(
  notificationRepository: NotificationRepository,
  userId: number,
  agentId: number,
  conversationId: number | null,
  updateStatus: ToolStatusUpdate
): Record<string, AiTool> {
  const notify_user = tool({
    description:
      "Send a notification to the user. Use when you have important findings, completed scheduled tasks, or urgent information. Delivery channels (push, email, etc.) are handled automatically based on the user's preferences.",
    inputSchema: notifyParams,
    execute: async (params) => {
      updateStatus("Sending notification...");

      const notification = await notificationRepository.create({
        user_id: userId,
        agent_id: agentId,
        conversation_id: conversationId ?? undefined,
        message: params.message,
        urgency: params.urgency,
      });

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

  return { notify_user };
}

const notifyParams = z.object({
  message: z.string().describe("The notification message"),
  urgency: z
    .enum(["low", "normal", "high"])
    .describe(
      "low = FYI, normal = should see soon, high = needs attention now"
    ),
});
