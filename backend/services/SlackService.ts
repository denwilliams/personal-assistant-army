import { WebClient } from "@slack/web-api";

export interface SlackMessageOptions {
  channel: string;
  text: string;
  thread_ts?: string; // For threading conversations
}

/**
 * Service for sending messages to Slack using the Web API
 */
export class SlackService {
  private clients: Map<string, WebClient> = new Map();

  /**
   * Get or create a Slack client for the given bot token
   */
  private getClient(botToken: string): WebClient {
    if (!this.clients.has(botToken)) {
      this.clients.set(botToken, new WebClient(botToken));
    }
    return this.clients.get(botToken)!;
  }

  /**
   * Send a message to a Slack channel/thread
   */
  async sendMessage(botToken: string, options: SlackMessageOptions): Promise<string> {
    const client = this.getClient(botToken);

    const result = await client.chat.postMessage({
      channel: options.channel,
      text: options.text,
      thread_ts: options.thread_ts,
    });

    if (!result.ok) {
      throw new Error(`Failed to send Slack message: ${result.error}`);
    }

    // Return the timestamp of the message (used as thread_ts for replies)
    return result.ts as string;
  }

  /**
   * Verify that a bot token is valid by testing API access
   */
  async verifyToken(botToken: string): Promise<boolean> {
    try {
      const client = this.getClient(botToken);
      const result = await client.auth.test();
      return result.ok === true;
    } catch (error) {
      return false;
    }
  }
}
