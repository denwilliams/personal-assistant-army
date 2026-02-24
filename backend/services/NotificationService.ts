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
    if (!settings?.notification_email || !settings.email_enabled) {
      throw new Error("Email notifications not configured");
    }

    // For V1: Log the email that would be sent
    // TODO: Integrate with a transactional email service (Resend, Mailgun, etc.)
    console.log(
      `[EMAIL] To: ${settings.notification_email}, ` +
        `Urgency: ${delivery.notification.urgency}, ` +
        `Message: ${delivery.notification.message.substring(0, 100)}`
    );
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

    const payload = {
      agent_id: delivery.notification.agent_id,
      message: delivery.notification.message,
      urgency: delivery.notification.urgency,
      conversation_id: delivery.notification.conversation_id,
      timestamp: delivery.notification.created_at,
    };

    // Fire to all configured webhooks
    const errors: string[] = [];
    for (const webhook of settings.webhook_urls) {
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

    if (errors.length === settings.webhook_urls.length) {
      // All webhooks failed
      throw new Error(`All webhooks failed: ${errors.join("; ")}`);
    }
  }
}
