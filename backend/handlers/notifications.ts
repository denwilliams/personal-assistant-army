import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import type { User } from "../types/models";

interface NotificationHandlerDependencies {
  agentRepository: AgentRepository;
  notificationRepository: NotificationRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

export function createNotificationHandlers(deps: NotificationHandlerDependencies) {
  /**
   * GET /api/notifications
   */
  const listNotifications = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const unreadOnly = url.searchParams.get("unread") === "true";
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");

      const notifications = await deps.notificationRepository.listByUser(
        auth.user.id,
        { unreadOnly, limit, offset }
      );
      return Response.json({ notifications });
    } catch (err) {
      console.error("Error listing notifications:", err);
      return Response.json({ error: "Failed to list notifications" }, { status: 500 });
    }
  };

  /**
   * GET /api/notifications/unread-count
   */
  const getUnreadCount = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const count = await deps.notificationRepository.countUnread(auth.user.id);
      return Response.json({ count });
    } catch (err) {
      console.error("Error getting unread count:", err);
      return Response.json({ error: "Failed to get unread count" }, { status: 500 });
    }
  };

  /**
   * PATCH /api/notifications/:id/read
   */
  const markRead = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const notificationId = parseInt(pathParts[pathParts.length - 2] ?? "");
      if (isNaN(notificationId)) return Response.json({ error: "Invalid notification ID" }, { status: 400 });

      await deps.notificationRepository.markRead(notificationId);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error marking notification read:", err);
      return Response.json({ error: "Failed to mark read" }, { status: 500 });
    }
  };

  /**
   * POST /api/notifications/read-all
   */
  const markAllRead = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      await deps.notificationRepository.markAllRead(auth.user.id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error marking all read:", err);
      return Response.json({ error: "Failed to mark all read" }, { status: 500 });
    }
  };

  /**
   * GET /api/user/notification-settings
   */
  const getSettings = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const settings = await deps.notificationRepository.getSettings(auth.user.id);
      return Response.json({ settings: settings || { notification_email: null, webhook_urls: [], email_enabled: true, pushover_user_key: null, pushover_enabled: false } });
    } catch (err) {
      console.error("Error getting notification settings:", err);
      return Response.json({ error: "Failed to get settings" }, { status: 500 });
    }
  };

  /**
   * PUT /api/user/notification-settings
   */
  const updateSettings = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const body = await req.json();
      const { notification_email, webhook_urls, email_enabled, pushover_user_key, pushover_enabled } = body;

      // Validate webhook URLs are HTTPS
      if (webhook_urls) {
        for (const webhook of webhook_urls) {
          if (!webhook.url || !webhook.url.startsWith("https://")) {
            return Response.json(
              { error: `Webhook URL must use HTTPS: ${webhook.url}` },
              { status: 400 }
            );
          }
        }
      }

      const settings = await deps.notificationRepository.upsertSettings(
        auth.user.id,
        { notification_email, webhook_urls, email_enabled, pushover_user_key, pushover_enabled }
      );

      return Response.json({ settings });
    } catch (err) {
      console.error("Error updating notification settings:", err);
      return Response.json({ error: "Failed to update settings" }, { status: 500 });
    }
  };

  /**
   * POST /api/agents/:slug/notifications/mute
   */
  const muteAgent = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? "";

      const agent = await deps.agentRepository.findBySlug(auth.user.id, slug);
      if (!agent || agent.user_id !== auth.user.id) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }

      const body = await req.json();
      const channels = body.channels || ["email", "webhook", "pushover"];

      await deps.notificationRepository.muteAgent(auth.user.id, agent.id, channels);
      return Response.json({ success: true, muted_channels: channels });
    } catch (err) {
      console.error("Error muting agent:", err);
      return Response.json({ error: "Failed to mute agent" }, { status: 500 });
    }
  };

  /**
   * DELETE /api/agents/:slug/notifications/mute
   */
  const unmuteAgent = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? "";

      const agent = await deps.agentRepository.findBySlug(auth.user.id, slug);
      if (!agent || agent.user_id !== auth.user.id) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }

      await deps.notificationRepository.unmuteAgent(auth.user.id, agent.id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error unmuting agent:", err);
      return Response.json({ error: "Failed to unmute agent" }, { status: 500 });
    }
  };

  return {
    listNotifications,
    getUnreadCount,
    markRead,
    markAllRead,
    getSettings,
    updateSettings,
    muteAgent,
    unmuteAgent,
  };
}
