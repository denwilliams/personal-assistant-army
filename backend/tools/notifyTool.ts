import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import { getContext } from "./context";

const notifyParams = z.object({
  message: z.string().describe("The notification message"),
  urgency: z
    .enum(["low", "normal", "high"])
    .describe("low = FYI, normal = should see soon, high = needs attention now"),
});

const notify_user = tool({
  description:
    "Send a notification to the user. Use when you have important findings, completed scheduled tasks, or urgent information. Delivery channels (push, email, etc.) are handled automatically based on the user's preferences.",
  inputSchema: notifyParams,
  execute: async (params, options) => {
    const { updateStatus, userId, agentId, conversationId, notificationRepository, notifierOverride } = getContext(options);
    updateStatus("Sending notification...");

    const notification = await notificationRepository.create({
      user_id: userId,
      agent_id: agentId,
      conversation_id: conversationId ?? undefined,
      message: params.message,
      urgency: params.urgency,
    });

    const settings = await notificationRepository.getSettings(userId);
    // Determine which channels are enabled based on user settings
    const enabledChannels: ('email' | 'webhook' | 'pushover')[] = [];
    if (settings?.email_enabled && settings.notification_email) {
      enabledChannels.push("email");
    }
    if (settings?.webhook_urls?.length) {
      enabledChannels.push("webhook");
    }
    if (settings?.pushover_enabled && settings.pushover_user_key) {
      enabledChannels.push("pushover");
    }

    // Apply notifier override: schedule.notifier > agent.default_notifier > all channels
    const channels = notifierOverride
      ? enabledChannels.filter((ch) => ch === notifierOverride)
      : enabledChannels;

    for (const channel of channels) {
      const muted = await notificationRepository.isAgentMuted(userId, agentId, channel);
      if (muted) continue;
      await notificationRepository.createDelivery(notification.id, channel);
    }

    console.log(
      `Agent sent notification: ${params.message.substring(0, 50)} (channels=web${channels.length > 0 ? "," + channels.join(",") : ""}${notifierOverride ? ", override=" + notifierOverride : ""})`
    );

    return JSON.stringify({
      success: true,
      notification_id: notification.id,
      message: "Notification sent",
    });
  },
});

/** Notification tools - always included for all agents */
export const notifyTools: Record<string, AiTool> = { notify_user };
