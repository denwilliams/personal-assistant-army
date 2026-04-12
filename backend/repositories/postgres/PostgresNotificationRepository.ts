import { sql } from "bun";
import type { Notification, NotificationDelivery, UserNotificationSettings, EmailConfig, WebhookConfig } from "../../types/models";
import type { NotificationRepository } from "../NotificationRepository";

function parseJsonArray<T>(val: unknown, fallback: T[]): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseSettings(row: any): UserNotificationSettings | null {
  if (!row) return null;
  return {
    ...row,
    email_addresses: parseJsonArray<EmailConfig>(row.email_addresses, []),
    webhook_urls: parseJsonArray<WebhookConfig>(row.webhook_urls, []),
  };
}

export class PostgresNotificationRepository implements NotificationRepository {
  async create(data: {
    user_id: number;
    agent_id: number;
    conversation_id?: number;
    message: string;
    urgency: 'low' | 'normal' | 'high';
  }): Promise<Notification> {
    const result = await sql`
      INSERT INTO notifications (user_id, agent_id, conversation_id, message, urgency)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.conversation_id ?? null}, ${data.message}, ${data.urgency})
      RETURNING *
    `;
    return result[0];
  }

  async listByUser(userId: number, options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Notification[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    if (options?.unreadOnly) {
      return await sql`
        SELECT * FROM notifications
        WHERE user_id = ${userId} AND read = FALSE
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return await sql`
      SELECT * FROM notifications
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async countUnread(userId: number): Promise<number> {
    const result = await sql`
      SELECT COUNT(*)::int as count FROM notifications
      WHERE user_id = ${userId} AND read = FALSE
    `;
    return result[0].count;
  }

  async markRead(id: number): Promise<void> {
    await sql`UPDATE notifications SET read = TRUE WHERE id = ${id}`;
  }

  async markAllRead(userId: number): Promise<void> {
    await sql`UPDATE notifications SET read = TRUE WHERE user_id = ${userId} AND read = FALSE`;
  }

  async createDelivery(notificationId: number, channel: 'email' | 'webhook' | 'pushover', destination?: string | null): Promise<NotificationDelivery> {
    const result = await sql`
      INSERT INTO notification_deliveries (notification_id, channel, destination, status)
      VALUES (${notificationId}, ${channel}, ${destination ?? null}, 'pending')
      RETURNING *
    `;
    return result[0];
  }

  async updateDelivery(id: number, data: {
    status: 'sent' | 'failed';
    error_message?: string;
  }): Promise<void> {
    const deliveredAt = data.status === 'sent' ? new Date() : null;
    await sql`
      UPDATE notification_deliveries
      SET status = ${data.status}, error_message = ${data.error_message ?? null},
          delivered_at = ${deliveredAt}, attempts = attempts + 1
      WHERE id = ${id}
    `;
  }

  async listPendingDeliveries(): Promise<(NotificationDelivery & { notification: Notification })[]> {
    const result = await sql`
      SELECT
        nd.*,
        n.user_id as "notification_user_id",
        n.agent_id as "notification_agent_id",
        n.conversation_id as "notification_conversation_id",
        n.message as "notification_message",
        n.urgency as "notification_urgency",
        n.read as "notification_read",
        n.created_at as "notification_created_at"
      FROM notification_deliveries nd
      JOIN notifications n ON n.id = nd.notification_id
      WHERE nd.status = 'pending' AND nd.attempts < 3
      ORDER BY nd.created_at ASC
      LIMIT 50
    `;

    return result.map((row: any) => ({
      id: row.id,
      notification_id: row.notification_id,
      channel: row.channel,
      destination: row.destination ?? null,
      status: row.status,
      error_message: row.error_message,
      attempts: row.attempts,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      notification: {
        id: row.notification_id,
        user_id: row.notification_user_id,
        agent_id: row.notification_agent_id,
        conversation_id: row.notification_conversation_id,
        message: row.notification_message,
        urgency: row.notification_urgency,
        read: row.notification_read,
        created_at: row.notification_created_at,
      },
    }));
  }

  async getSettings(userId: number): Promise<UserNotificationSettings | null> {
    const result = await sql`
      SELECT * FROM user_notification_settings WHERE user_id = ${userId}
    `;
    return parseSettings(result[0]);
  }

  async upsertSettings(userId: number, data: Partial<Pick<UserNotificationSettings, 'notification_email' | 'email_addresses' | 'webhook_urls' | 'email_enabled' | 'pushover_user_key' | 'pushover_api_token' | 'pushover_enabled'>>): Promise<UserNotificationSettings> {
    const current = await this.getSettings(userId);

    const email = data.notification_email ?? current?.notification_email ?? null;
    const emailAddresses = data.email_addresses ?? current?.email_addresses ?? [];
    const webhookUrls = data.webhook_urls ?? current?.webhook_urls ?? [];
    const emailEnabled = data.email_enabled ?? current?.email_enabled ?? true;
    const pushoverUserKey = data.pushover_user_key ?? current?.pushover_user_key ?? null;
    const pushoverApiToken = data.pushover_api_token ?? current?.pushover_api_token ?? null;
    const pushoverEnabled = data.pushover_enabled ?? current?.pushover_enabled ?? false;

    const result = await sql`
      INSERT INTO user_notification_settings (user_id, notification_email, email_addresses, webhook_urls, email_enabled, pushover_user_key, pushover_api_token, pushover_enabled)
      VALUES (${userId}, ${email}, ${JSON.stringify(emailAddresses)}, ${JSON.stringify(webhookUrls)}, ${emailEnabled}, ${pushoverUserKey}, ${pushoverApiToken}, ${pushoverEnabled})
      ON CONFLICT (user_id)
      DO UPDATE SET notification_email = ${email},
                    email_addresses = ${JSON.stringify(emailAddresses)},
                    webhook_urls = ${JSON.stringify(webhookUrls)},
                    email_enabled = ${emailEnabled}, pushover_user_key = ${pushoverUserKey},
                    pushover_api_token = ${pushoverApiToken},
                    pushover_enabled = ${pushoverEnabled}, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return parseSettings(result[0])!;
  }

  async isAgentMuted(userId: number, agentId: number, channel: string): Promise<boolean> {
    const result = await sql`
      SELECT muted_channels FROM agent_notification_mutes
      WHERE user_id = ${userId} AND agent_id = ${agentId}
    `;
    if (!result[0]) return false;
    const channels = result[0].muted_channels;
    return Array.isArray(channels) && channels.includes(channel);
  }

  async muteAgent(userId: number, agentId: number, channels: string[]): Promise<void> {
    await sql`
      INSERT INTO agent_notification_mutes (user_id, agent_id, muted_channels)
      VALUES (${userId}, ${agentId}, ${channels})
      ON CONFLICT (user_id, agent_id)
      DO UPDATE SET muted_channels = ${channels}
    `;
  }

  async unmuteAgent(userId: number, agentId: number): Promise<void> {
    await sql`
      DELETE FROM agent_notification_mutes
      WHERE user_id = ${userId} AND agent_id = ${agentId}
    `;
  }

  async countRecentByAgentAndChannel(agentId: number, channel: string, sinceMinutes: number): Promise<number> {
    const result = await sql`
      SELECT COUNT(*)::int as count
      FROM notification_deliveries nd
      JOIN notifications n ON n.id = nd.notification_id
      WHERE n.agent_id = ${agentId}
        AND nd.channel = ${channel}
        AND nd.status = 'sent'
        AND nd.delivered_at >= NOW() - INTERVAL '1 minute' * ${sinceMinutes}
    `;
    return result[0].count;
  }
}
