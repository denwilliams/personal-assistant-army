import type { Notification, NotificationDelivery } from "../types/models";
import type { NotificationRepository } from "../repositories/NotificationRepository";

interface NotificationServiceDeps {
  notificationRepository: NotificationRepository;
}

export class NotificationService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private deps: NotificationServiceDeps) {}

  start(intervalMs = 10_000) {
    console.log(`Notification service started (polling every ${intervalMs / 1000}s)`);
    this.tick(intervalMs);
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("Notification service stopped");
  }

  private tick(intervalMs: number) {
    this.timer = setTimeout(async () => {
      if (!this.running) {
        this.running = true;
        try {
          await this.poll();
        } catch (err) {
          console.error("Notification service poll error:", err);
        } finally {
          this.running = false;
        }
      }
      this.tick(intervalMs);
    }, intervalMs);
  }

  private async poll() {
    const pending =
      await this.deps.notificationRepository.listPendingDeliveries();
    if (pending.length === 0) return;

    console.log(
      `Notification service: processing ${pending.length} pending deliveries`
    );

    for (const delivery of pending) {
      await this.processDelivery(delivery);
    }
  }

  private async processDelivery(
    delivery: NotificationDelivery & { notification: Notification }
  ) {
    try {
      if (delivery.channel === "email") {
        await this.sendEmail(delivery);
      } else if (delivery.channel === "webhook") {
        await this.sendWebhook(delivery);
      } else if (delivery.channel === "pushover") {
        await this.sendPushover(delivery);
      }

      await this.deps.notificationRepository.updateDelivery(delivery.id, {
        status: "sent",
      });
    } catch (err) {
      console.error(
        `Notification delivery ${delivery.id} (${delivery.channel}) failed:`,
        err
      );

      const attempts = delivery.attempts + 1;
      if (attempts >= 3) {
        await this.deps.notificationRepository.updateDelivery(delivery.id, {
          status: "failed",
          error_message:
            err instanceof Error ? err.message : String(err),
        });
      }
      // If under 3 attempts, stays pending for retry on next poll
      // (updateDelivery increments attempts)
    }
  }

  private async sendEmail(
    delivery: NotificationDelivery & { notification: Notification }
  ) {
    // Rate limit: 5 per agent per hour
    const recentCount =
      await this.deps.notificationRepository.countRecentByAgentAndChannel(
        delivery.notification.agent_id,
        "email",
        60
      );
    if (recentCount >= 5) {
      throw new Error("Email rate limit exceeded (5/hour per agent)");
    }

    const settings = await this.deps.notificationRepository.getSettings(
      delivery.notification.user_id
    );
    if (!settings || !settings.email_enabled) {
      throw new Error("Email notifications not configured");
    }

    // Build the list of target recipients. Prefer the structured array;
    // fall back to the legacy single notification_email for backwards compat.
    let recipients = settings.email_addresses ?? [];
    if (recipients.length === 0 && settings.notification_email) {
      recipients = [{ name: "Default", email: settings.notification_email }];
    }

    // If a named destination was requested, filter to it.
    if (delivery.destination) {
      recipients = recipients.filter((r) => r.name === delivery.destination);
      if (recipients.length === 0) {
        throw new Error(
          `Named email destination not found: ${delivery.destination}`
        );
      }
    }

    if (recipients.length === 0) {
      throw new Error("No email recipients configured");
    }

    // For V1: Log the emails that would be sent
    // TODO: Integrate with a transactional email service (Resend, Mailgun, etc.)
    for (const recipient of recipients) {
      console.log(
        `[EMAIL] To: ${recipient.name} <${recipient.email}>, ` +
          `Urgency: ${delivery.notification.urgency}, ` +
          `Message: ${delivery.notification.message.substring(0, 100)}`
      );
    }
  }

  private async sendWebhook(
    delivery: NotificationDelivery & { notification: Notification }
  ) {
    const settings = await this.deps.notificationRepository.getSettings(
      delivery.notification.user_id
    );
    if (!settings?.webhook_urls?.length) {
      throw new Error("No webhooks configured");
    }

    // If a named destination was requested, filter to it.
    let webhooks = settings.webhook_urls;
    if (delivery.destination) {
      webhooks = webhooks.filter((w) => w.name === delivery.destination);
      if (webhooks.length === 0) {
        throw new Error(
          `Named webhook destination not found: ${delivery.destination}`
        );
      }
    }

    const payload = {
      agent_id: delivery.notification.agent_id,
      message: delivery.notification.message,
      urgency: delivery.notification.urgency,
      conversation_id: delivery.notification.conversation_id,
      timestamp: delivery.notification.created_at,
    };

    // Fire to the selected webhooks
    const errors: string[] = [];
    for (const webhook of webhooks) {
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          errors.push(
            `${webhook.name}: HTTP ${response.status}`
          );
        }
      } catch (err) {
        errors.push(
          `${webhook.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (errors.length === webhooks.length) {
      // All selected webhooks failed
      throw new Error(`All webhooks failed: ${errors.join("; ")}`);
    }
  }

  private async sendPushover(
    delivery: NotificationDelivery & { notification: Notification }
  ) {
    const settings = await this.deps.notificationRepository.getSettings(
      delivery.notification.user_id
    );
    if (!settings?.pushover_user_key || !settings?.pushover_api_token || !settings.pushover_enabled) {
      throw new Error("Pushover not configured for user");
    }

    // Map urgency to Pushover priority
    // -2=lowest, -1=low, 0=normal, 1=high, 2=emergency
    const priorityMap: Record<string, number> = {
      low: -1,
      normal: 0,
      high: 1,
    };
    const priority = priorityMap[delivery.notification.urgency] ?? 0;

    const body = new URLSearchParams({
      token: settings.pushover_api_token,
      user: settings.pushover_user_key,
      message: delivery.notification.message,
      priority: String(priority),
      title: "Assistant Army",
    });

    const response = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pushover API error ${response.status}: ${text}`);
    }
  }
}
