import type { ModelMessage } from "ai";
import type { SlackRepository } from "../repositories/SlackRepository";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { AgentFactory } from "./AgentFactory";
import { DatabaseSession } from "./DatabaseSession";
import { decrypt } from "../utils/encryption";
import { EmbeddingService } from "./EmbeddingService";
import type { ApiKeys } from "./ModelResolver";

interface SlackServiceDeps {
  slackRepository: SlackRepository;
  agentRepository: AgentRepository;
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  userRepository: UserRepository;
  encryptionSecret: string;
}

interface ClientWrapper {
  ws: WebSocket | null;
  userId: number;
  botToken: string; // decrypted
  appToken: string; // decrypted
  botUserId: string | null;
  connected: boolean;
  closing: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  processedEventIds: Set<string>;
}

const MAX_PROCESSED_EVENTS = 500;
const RECONNECT_DELAY_MS = 5000;

export class SlackService {
  private clients = new Map<number, ClientWrapper>();

  constructor(private deps: SlackServiceDeps) {}

  async start() {
    const configs = await this.deps.slackRepository.listEnabledConfigs();
    if (configs.length === 0) {
      console.log("Slack service: no enabled configs found, skipping startup");
      return;
    }

    console.log(`Slack service starting (${configs.length} config(s))...`);
    for (const config of configs) {
      try {
        await this.connectUser(config.user_id);
      } catch (err) {
        console.error(`Slack: Failed to connect user ${config.user_id}:`, err);
      }
    }
  }

  stop() {
    for (const [userId, wrapper] of this.clients) {
      wrapper.closing = true;
      if (wrapper.reconnectTimer) clearTimeout(wrapper.reconnectTimer);
      try {
        wrapper.ws?.close();
      } catch (err) {
        console.error(`Slack: Error closing connection for user ${userId}:`, err);
      }
    }
    this.clients.clear();
    console.log("Slack service stopped");
  }

  async connectUser(userId: number): Promise<void> {
    await this.disconnectUser(userId);

    const config = await this.deps.slackRepository.getConfig(userId);
    if (!config || !config.enabled) return;

    const botToken = await decrypt(config.bot_token, this.deps.encryptionSecret);
    const appToken = await decrypt(config.app_token, this.deps.encryptionSecret);

    // Resolve bot user ID via auth.test so we can ignore our own messages
    const botUserId = await this.fetchBotUserId(botToken).catch((err) => {
      console.error(`Slack: auth.test failed for user ${userId}:`, err);
      return null;
    });

    const wrapper: ClientWrapper = {
      ws: null,
      userId,
      botToken,
      appToken,
      botUserId,
      connected: false,
      closing: false,
      reconnectTimer: null,
      processedEventIds: new Set(),
    };
    this.clients.set(userId, wrapper);

    await this.openSocket(wrapper);
  }

  async disconnectUser(userId: number): Promise<void> {
    const wrapper = this.clients.get(userId);
    if (!wrapper) return;
    wrapper.closing = true;
    if (wrapper.reconnectTimer) clearTimeout(wrapper.reconnectTimer);
    try {
      wrapper.ws?.close();
    } catch {
      // ignore
    }
    this.clients.delete(userId);
  }

  getStatus(userId: number): { connected: boolean } {
    const wrapper = this.clients.get(userId);
    return { connected: !!wrapper?.connected };
  }

  private async openSocket(wrapper: ClientWrapper): Promise<void> {
    const wsUrl = await this.openConnectionUrl(wrapper.appToken);
    if (!wsUrl) {
      this.scheduleReconnect(wrapper);
      return;
    }

    const ws = new WebSocket(wsUrl);
    wrapper.ws = ws;

    ws.addEventListener("open", () => {
      wrapper.connected = true;
      console.log(`Slack: User ${wrapper.userId} connected`);
    });

    ws.addEventListener("message", (event) => {
      void this.handleSocketMessage(wrapper, event.data as string);
    });

    ws.addEventListener("close", () => {
      wrapper.connected = false;
      console.log(`Slack: User ${wrapper.userId} disconnected`);
      if (!wrapper.closing) this.scheduleReconnect(wrapper);
    });

    ws.addEventListener("error", (err) => {
      console.error(`Slack: WebSocket error for user ${wrapper.userId}:`, err);
    });
  }

  private scheduleReconnect(wrapper: ClientWrapper): void {
    if (wrapper.closing) return;
    if (wrapper.reconnectTimer) clearTimeout(wrapper.reconnectTimer);
    wrapper.reconnectTimer = setTimeout(() => {
      if (!wrapper.closing) {
        this.openSocket(wrapper).catch((err) => {
          console.error(`Slack: Reconnect failed for user ${wrapper.userId}:`, err);
          this.scheduleReconnect(wrapper);
        });
      }
    }, RECONNECT_DELAY_MS);
  }

  private async openConnectionUrl(appToken: string): Promise<string | null> {
    try {
      const res = await fetch("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!data.ok || !data.url) {
        console.error("Slack: apps.connections.open failed:", data.error);
        return null;
      }
      return data.url;
    } catch (err) {
      console.error("Slack: apps.connections.open error:", err);
      return null;
    }
  }

  private async fetchBotUserId(botToken: string): Promise<string | null> {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const data = (await res.json()) as { ok: boolean; user_id?: string; error?: string };
    if (!data.ok) {
      throw new Error(data.error || "auth.test failed");
    }
    return data.user_id ?? null;
  }

  private async handleSocketMessage(wrapper: ClientWrapper, raw: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Disconnect messages ask us to reconnect
    if (msg.type === "disconnect") {
      try {
        wrapper.ws?.close();
      } catch {
        // ignore
      }
      return;
    }

    // Hello frames are informational
    if (msg.type === "hello") return;

    // Events API frames must be acknowledged
    if (msg.type === "events_api" && msg.envelope_id) {
      this.sendAck(wrapper, msg.envelope_id);

      const envelopeId = msg.envelope_id as string;
      if (wrapper.processedEventIds.has(envelopeId)) return;
      wrapper.processedEventIds.add(envelopeId);
      if (wrapper.processedEventIds.size > MAX_PROCESSED_EVENTS) {
        const first = wrapper.processedEventIds.values().next().value;
        if (first) wrapper.processedEventIds.delete(first);
      }

      const event = msg.payload?.event;
      if (!event) return;
      if (event.type !== "message" && event.type !== "app_mention") return;

      // Ignore bot messages (including our own) and message edits/deletes
      if (event.bot_id) return;
      if (event.subtype && event.subtype !== "file_share") return;
      if (wrapper.botUserId && event.user === wrapper.botUserId) return;

      void this.handleChannelMessage(wrapper, event).catch((err) => {
        console.error(`Slack: Error handling message for user ${wrapper.userId}:`, err);
      });
    }
  }

  private sendAck(wrapper: ClientWrapper, envelopeId: string): void {
    try {
      wrapper.ws?.send(JSON.stringify({ envelope_id: envelopeId }));
    } catch (err) {
      console.error("Slack: Failed to ack envelope:", err);
    }
  }

  private async handleChannelMessage(wrapper: ClientWrapper, event: any): Promise<void> {
    const channelId: string = event.channel;
    const text: string = event.text || "";
    const threadTs: string | undefined = event.thread_ts || event.ts;
    if (!channelId || !text) return;

    // Find which agent handles this channel; fall back to the default agent
    const mapping = await this.deps.slackRepository.findChannelAgent(wrapper.userId, channelId);

    let agentId: number | null = mapping?.agent_id ?? null;
    if (!agentId) {
      const config = await this.deps.slackRepository.getConfig(wrapper.userId);
      agentId = config?.default_agent_id ?? null;
    }
    if (!agentId) {
      console.log(`Slack: No agent assigned for channel ${channelId} (user ${wrapper.userId})`);
      return;
    }

    const agent = await this.deps.agentRepository.findById(agentId);
    if (!agent || agent.user_id !== wrapper.userId) {
      console.warn(`Slack: Agent ${agentId} missing or not owned by user ${wrapper.userId}`);
      return;
    }

    const user = await this.deps.userRepository.findById(wrapper.userId);
    if (!user) return;

    const apiKeys: ApiKeys = {};
    if (user.openai_api_key) apiKeys.openai = await decrypt(user.openai_api_key, this.deps.encryptionSecret);
    if (user.anthropic_api_key) apiKeys.anthropic = await decrypt(user.anthropic_api_key, this.deps.encryptionSecret);
    if (user.google_ai_api_key) apiKeys.google = await decrypt(user.google_ai_api_key, this.deps.encryptionSecret);
    if (user.ollama_url) apiKeys.ollama_url = user.ollama_url;

    if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google && !apiKeys.ollama_url) {
      console.warn(`Slack: No API keys configured for user ${wrapper.userId}`);
      return;
    }

    // Use one conversation per Slack thread so follow-ups stay in context
    const conversationTitle = `[Slack] ${channelId}/${threadTs ?? "msg"}`;
    const conversation = await this.deps.conversationRepository.create({
      user_id: wrapper.userId,
      agent_id: agent.id,
      title: conversationTitle,
      source: "slack",
    });

    const embeddingService = apiKeys.openai ? new EmbeddingService(apiKeys.openai) : null;

    let googleSearchApiKey: string | undefined;
    if (user.google_search_api_key) {
      googleSearchApiKey = await decrypt(user.google_search_api_key, this.deps.encryptionSecret);
    }

    const agentInstance = await this.deps.agentFactory.createAgent(
      wrapper.userId,
      agent.slug,
      () => {},
      apiKeys,
      {
        conversationId: conversation.id,
        generateEmbedding: embeddingService ? (t) => embeddingService.generate(t) : undefined,
        googleSearchApiKey,
        googleSearchEngineId: user.google_search_engine_id,
        domain: user.email.split("@")[1] || "",
      }
    );

    const session = new DatabaseSession(conversation.id, this.deps.conversationRepository);
    // Strip bot mention from the text before feeding it to the agent
    const cleanedText = wrapper.botUserId
      ? text.replace(new RegExp(`<@${wrapper.botUserId}>`, "g"), "").trim()
      : text;
    await session.addUserMessage(cleanedText);
    const messages = await session.getMessages();

    try {
      const result = await agentInstance.agent.generate({ messages });
      await session.saveResponseMessages(result.response.messages as ModelMessage[]);

      const replyText = result.text || "[No response]";
      await this.postMessage(wrapper.botToken, channelId, replyText, threadTs);
    } catch (err) {
      console.error(`Slack: Agent execution failed for user ${wrapper.userId}:`, err);
      await this.postMessage(
        wrapper.botToken,
        channelId,
        `Sorry, something went wrong: ${err instanceof Error ? err.message : "unknown error"}`,
        threadTs
      ).catch(() => {});
    }
  }

  private async postMessage(
    botToken: string,
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<void> {
    const body: Record<string, string> = { channel, text };
    if (threadTs) body.thread_ts = threadTs;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`chat.postMessage failed: ${data.error}`);
    }
  }
}
