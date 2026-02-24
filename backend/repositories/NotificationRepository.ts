import type { Notification, NotificationDelivery, UserNotificationSettings } from "../types/models";

export interface NotificationRepository {
  create(data: {
    user_id: number;
    agent_id: number;
    conversation_id?: number;
    message: string;
    urgency: 'low' | 'normal' | 'high';
  }): Promise<Notification>;

  listByUser(userId: number, options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Notification[]>;

  countUnread(userId: number): Promise<number>;
  markRead(id: number): Promise<void>;
  markAllRead(userId: number): Promise<void>;

  /** Delivery tracking */
  createDelivery(notificationId: number, channel: 'email' | 'webhook' | 'pushover'): Promise<NotificationDelivery>;
  updateDelivery(id: number, data: {
    status: 'sent' | 'failed';
    error_message?: string;
  }): Promise<void>;
  listPendingDeliveries(): Promise<(NotificationDelivery & { notification: Notification })[]>;

  /** User notification settings */
  getSettings(userId: number): Promise<UserNotificationSettings | null>;
  upsertSettings(userId: number, data: Partial<Pick<UserNotificationSettings, 'notification_email' | 'webhook_urls' | 'email_enabled' | 'pushover_user_key' | 'pushover_api_token' | 'pushover_enabled'>>): Promise<UserNotificationSettings>;

  /** Per-agent muting */
  isAgentMuted(userId: number, agentId: number, channel: string): Promise<boolean>;
  muteAgent(userId: number, agentId: number, channels: string[]): Promise<void>;
  unmuteAgent(userId: number, agentId: number): Promise<void>;

  /** Rate limiting check - count deliveries for an agent+channel in last N minutes */
  countRecentByAgentAndChannel(agentId: number, channel: string, sinceMinutes: number): Promise<number>;
}
