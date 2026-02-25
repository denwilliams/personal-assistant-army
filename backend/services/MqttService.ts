import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { run, setDefaultOpenAIKey } from "@openai/agents";
import type { MqttSubscription } from "../types/models";
import type { MqttRepository } from "../repositories/MqttRepository";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { AgentFactory } from "./AgentFactory";
import { DatabaseSession } from "./DatabaseSession";
import { decrypt } from "../utils/encryption";
import { EmbeddingService } from "./EmbeddingService";

interface MqttServiceDeps {
  mqttRepository: MqttRepository;
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  userRepository: UserRepository;
  encryptionSecret: string;
}

interface ClientWrapper {
  client: MqttClient;
  userId: number;
  subscribedTopics: Set<string>;
}

const MAX_PAYLOAD_SIZE = 10240; // 10KB
const MAX_QUEUE_PER_USER = 100;
const MESSAGE_PRUNE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MESSAGE_MAX_AGE = 60 * 60 * 1000; // 1 hour

export class MqttService {
  private clients = new Map<number, ClientWrapper>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  // Rate limiting: in-memory sliding window
  private rateLimitWindows = new Map<number, number[]>(); // subscriptionId -> timestamps
  // Per-user execution queue
  private userQueues = new Map<number, Array<() => Promise<void>>>();
  private userExecuting = new Map<number, boolean>();

  constructor(private deps: MqttServiceDeps) {}

  async start() {
    console.log("MQTT service starting...");

    // Load all users with enabled broker configs
    const configs = await this.deps.mqttRepository.listEnabledBrokerConfigs();
    for (const config of configs) {
      const subs = await this.deps.mqttRepository.listEnabledSubscriptionsByUser(config.user_id);
      if (subs.length > 0) {
        try {
          await this.connectUser(config.user_id);
        } catch (err) {
          console.error(`MQTT: Failed to connect user ${config.user_id}:`, err);
        }
      }
    }

    // Start periodic message cleanup
    this.pruneTimer = setInterval(async () => {
      try {
        const pruned = await this.deps.mqttRepository.pruneOldMessages(MESSAGE_MAX_AGE);
        if (pruned > 0) {
          console.log(`MQTT: Pruned ${pruned} old messages`);
        }
      } catch (err) {
        console.error("MQTT: Prune error:", err);
      }
    }, MESSAGE_PRUNE_INTERVAL);

    console.log(`MQTT service started (${configs.length} broker config(s) found)`);
  }

  stop() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }

    for (const [userId, wrapper] of this.clients) {
      try {
        wrapper.client.end(true);
      } catch (err) {
        console.error(`MQTT: Error disconnecting user ${userId}:`, err);
      }
    }
    this.clients.clear();
    console.log("MQTT service stopped");
  }

  async connectUser(userId: number): Promise<void> {
    // Disconnect existing connection if any
    await this.disconnectUser(userId);

    const config = await this.deps.mqttRepository.getBrokerConfig(userId);
    if (!config || !config.enabled) return;

    // Decrypt credentials
    let username: string | undefined;
    let password: string | undefined;
    if (config.username) {
      username = await decrypt(config.username, this.deps.encryptionSecret);
    }
    if (config.password) {
      password = await decrypt(config.password, this.deps.encryptionSecret);
    }

    const protocol = config.use_tls ? "mqtts" : "mqtt";
    const clientId = config.client_id || `paa-${userId}-${Date.now()}`;

    const client = mqtt.connect(`${protocol}://${config.host}:${config.port}`, {
      clientId,
      username,
      password,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    const wrapper: ClientWrapper = {
      client,
      userId,
      subscribedTopics: new Set(),
    };

    client.on("connect", async () => {
      console.log(`MQTT: User ${userId} connected to ${config.host}:${config.port}`);
      // Subscribe to all enabled topics
      try {
        const subs = await this.deps.mqttRepository.listEnabledSubscriptionsByUser(userId);
        for (const sub of subs) {
          client.subscribe(sub.topic, { qos: sub.qos as 0 | 1 | 2 }, (err) => {
            if (err) {
              console.error(`MQTT: Failed to subscribe to ${sub.topic}:`, err);
            } else {
              wrapper.subscribedTopics.add(sub.topic);
            }
          });
        }
      } catch (err) {
        console.error(`MQTT: Error loading subscriptions for user ${userId}:`, err);
      }
    });

    client.on("error", (err) => {
      console.error(`MQTT: User ${userId} error:`, err.message);
    });

    client.on("message", async (topic, payloadBuffer, packet) => {
      let payload = payloadBuffer.toString("utf-8");

      // Enforce payload size limit
      if (payload.length > MAX_PAYLOAD_SIZE) {
        payload = payload.substring(0, MAX_PAYLOAD_SIZE);
      }

      try {
        // Store message in buffer
        const msg = await this.deps.mqttRepository.storeMessage(
          userId,
          topic,
          payload,
          packet.qos,
          packet.retain ?? false
        );

        // Find matching subscriptions and trigger agents
        await this.handleIncomingMessage(userId, topic, payload, msg.id);
      } catch (err) {
        console.error(`MQTT: Error handling message on ${topic}:`, err);
      }
    });

    client.on("offline", () => {
      console.log(`MQTT: User ${userId} went offline`);
    });

    client.on("reconnect", () => {
      console.log(`MQTT: User ${userId} reconnecting...`);
    });

    this.clients.set(userId, wrapper);
  }

  async disconnectUser(userId: number): Promise<void> {
    const wrapper = this.clients.get(userId);
    if (wrapper) {
      try {
        wrapper.client.end(true);
      } catch {
        // Ignore errors during disconnect
      }
      this.clients.delete(userId);
    }
  }

  async refreshSubscriptions(userId: number): Promise<void> {
    const wrapper = this.clients.get(userId);
    if (!wrapper) {
      // Not connected yet, try connecting
      const config = await this.deps.mqttRepository.getBrokerConfig(userId);
      if (config?.enabled) {
        await this.connectUser(userId);
      }
      return;
    }

    const subs = await this.deps.mqttRepository.listEnabledSubscriptionsByUser(userId);
    const desiredTopics = new Set(subs.map((s) => s.topic));

    // Unsubscribe from topics no longer needed
    for (const topic of wrapper.subscribedTopics) {
      if (!desiredTopics.has(topic)) {
        wrapper.client.unsubscribe(topic);
        wrapper.subscribedTopics.delete(topic);
      }
    }

    // Subscribe to new topics
    for (const sub of subs) {
      if (!wrapper.subscribedTopics.has(sub.topic)) {
        wrapper.client.subscribe(sub.topic, { qos: sub.qos as 0 | 1 | 2 }, (err) => {
          if (err) {
            console.error(`MQTT: Failed to subscribe to ${sub.topic}:`, err);
          } else {
            wrapper.subscribedTopics.add(sub.topic);
          }
        });
      }
    }
  }

  /**
   * Publish a message to the broker for a given user
   */
  async publish(userId: number, topic: string, payload: string, qos: 0 | 1 | 2 = 0, retain = false): Promise<void> {
    const wrapper = this.clients.get(userId);
    if (!wrapper) {
      throw new Error("MQTT not connected. Configure your MQTT broker in Profile settings.");
    }

    return new Promise((resolve, reject) => {
      wrapper.client.publish(topic, payload, { qos, retain }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get connection status for a user
   */
  getStatus(userId: number): { connected: boolean; error?: string } {
    const wrapper = this.clients.get(userId);
    if (!wrapper) return { connected: false };
    return { connected: wrapper.client.connected };
  }

  /**
   * Handle incoming MQTT message - find matching subscriptions and trigger agents
   */
  private async handleIncomingMessage(userId: number, topic: string, payload: string, messageId: number): Promise<void> {
    const subs = await this.deps.mqttRepository.listEnabledSubscriptionsByUser(userId);

    for (const sub of subs) {
      if (!this.topicMatches(sub.topic, topic)) continue;

      // Rate limit check (in-memory first)
      if (!this.checkRateLimit(sub)) {
        await this.deps.mqttRepository.logExecution({
          subscription_id: sub.id,
          mqtt_message_id: messageId,
          status: "rate_limited",
        });
        continue;
      }

      // Queue execution
      this.enqueueExecution(userId, () =>
        this.executeSubscription(sub, topic, payload, messageId)
      );
    }
  }

  /**
   * Check rate limit for a subscription using in-memory sliding window
   */
  private checkRateLimit(sub: MqttSubscription): boolean {
    const now = Date.now();
    const windowMs = Number(sub.rate_limit_window_ms);
    const maxTriggers = sub.rate_limit_max_triggers;

    let timestamps = this.rateLimitWindows.get(sub.id) || [];

    // Remove expired timestamps
    timestamps = timestamps.filter((t) => now - t < windowMs);
    this.rateLimitWindows.set(sub.id, timestamps);

    if (timestamps.length >= maxTriggers) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Enqueue execution for a user (serialized per user)
   */
  private enqueueExecution(userId: number, fn: () => Promise<void>): void {
    let queue = this.userQueues.get(userId);
    if (!queue) {
      queue = [];
      this.userQueues.set(userId, queue);
    }

    if (queue.length >= MAX_QUEUE_PER_USER) {
      console.warn(`MQTT: Queue full for user ${userId}, dropping message`);
      return;
    }

    queue.push(fn);
    this.processQueue(userId);
  }

  private async processQueue(userId: number): Promise<void> {
    if (this.userExecuting.get(userId)) return;
    this.userExecuting.set(userId, true);

    const queue = this.userQueues.get(userId);
    while (queue && queue.length > 0) {
      const fn = queue.shift()!;
      try {
        await fn();
      } catch (err) {
        console.error(`MQTT: Execution error for user ${userId}:`, err);
      }
    }

    this.userExecuting.set(userId, false);
  }

  /**
   * Execute a subscription trigger (follows SchedulerService.executeSchedule pattern)
   */
  private async executeSubscription(
    sub: MqttSubscription,
    topic: string,
    payload: string,
    messageId: number
  ): Promise<void> {
    const payloadPreview = payload.length > 50 ? payload.substring(0, 50) + "..." : payload;
    console.log(`MQTT: Triggering agent for subscription ${sub.id} (topic: ${topic})`);

    const execution = await this.deps.mqttRepository.logExecution({
      subscription_id: sub.id,
      mqtt_message_id: messageId,
      status: "running",
    });

    try {
      // Load user for API key
      const user = await this.deps.userRepository.findById(sub.user_id);
      if (!user) throw new Error("User not found");
      if (!user.openai_api_key) throw new Error("No OpenAI API key configured");

      const openaiApiKey = await decrypt(user.openai_api_key, this.deps.encryptionSecret);

      // Resolve agent
      const agentConfig = await this.deps.agentFactory.getAgentConfigById(sub.user_id, sub.agent_id);

      // Get or create conversation
      let conversationId = sub.conversation_id;
      if (sub.conversation_mode === "new" || !conversationId) {
        const conversation = await this.deps.conversationRepository.create({
          user_id: sub.user_id,
          agent_id: sub.agent_id,
          title: `[MQTT] ${topic}: ${payloadPreview}`,
        });
        conversationId = conversation.id;
      }

      // Build prompt from template
      const prompt = sub.prompt_template
        .replace(/\{topic\}/g, topic)
        .replace(/\{payload\}/g, payload);

      // Create agent and run
      const embeddingService = new EmbeddingService(openaiApiKey);
      const context = { ...user, updateStatus: () => {} };
      const agent = await this.deps.agentFactory.createAgent(context, agentConfig.slug, {
        conversationId,
        generateEmbedding: (text) => embeddingService.generate(text),
      });

      setDefaultOpenAIKey(openaiApiKey);

      const session = new DatabaseSession(conversationId, this.deps.conversationRepository);

      await run(agent, prompt, {
        context,
        session,
      });

      // Success
      await this.deps.mqttRepository.updateExecution(execution.id, {
        status: "success",
        completed_at: Date.now(),
        conversation_id: conversationId,
      });

      console.log(`MQTT: Subscription ${sub.id} executed successfully`);
    } catch (err) {
      console.error(`MQTT: Subscription ${sub.id} execution failed:`, err);

      await this.deps.mqttRepository.updateExecution(execution.id, {
        status: "error",
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: Date.now(),
      });
    }
  }

  /**
   * MQTT topic wildcard matching
   * '+' matches exactly one level, '#' matches zero or more levels
   */
  private topicMatches(pattern: string, topic: string): boolean {
    // Exact match
    if (pattern === topic) return true;

    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];

      // '#' matches everything remaining
      if (p === "#") return true;

      // '+' matches exactly one level
      if (p === "+") {
        if (i >= topicParts.length) return false;
        continue;
      }

      // Exact match for this level
      if (i >= topicParts.length || p !== topicParts[i]) return false;
    }

    // Pattern consumed but topic has more levels
    return patternParts.length === topicParts.length;
  }
}
