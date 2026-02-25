import { sql } from "bun";
import type { MqttBrokerConfig, MqttSubscription, MqttMessage, MqttEventExecution } from "../../types/models";
import type { MqttRepository, UpsertBrokerConfigData, CreateSubscriptionData } from "../MqttRepository";

export class PostgresMqttRepository implements MqttRepository {
  // --- Broker config ---

  async getBrokerConfig(userId: number): Promise<MqttBrokerConfig | null> {
    const result = await sql`
      SELECT * FROM mqtt_broker_configs WHERE user_id = ${userId}
    `;
    return result[0] || null;
  }

  async upsertBrokerConfig(data: UpsertBrokerConfigData): Promise<MqttBrokerConfig> {
    const result = await sql`
      INSERT INTO mqtt_broker_configs (user_id, host, port, username, password, use_tls, client_id, enabled)
      VALUES (${data.user_id}, ${data.host}, ${data.port}, ${data.username ?? null}, ${data.password ?? null}, ${data.use_tls}, ${data.client_id ?? null}, ${data.enabled ?? true})
      ON CONFLICT (user_id) DO UPDATE SET
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        username = COALESCE(EXCLUDED.username, mqtt_broker_configs.username),
        password = COALESCE(EXCLUDED.password, mqtt_broker_configs.password),
        use_tls = EXCLUDED.use_tls,
        client_id = EXCLUDED.client_id,
        enabled = EXCLUDED.enabled,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return result[0];
  }

  async deleteBrokerConfig(userId: number): Promise<void> {
    await sql`DELETE FROM mqtt_broker_configs WHERE user_id = ${userId}`;
  }

  async listEnabledBrokerConfigs(): Promise<MqttBrokerConfig[]> {
    return await sql`
      SELECT * FROM mqtt_broker_configs WHERE enabled = TRUE
    `;
  }

  // --- Subscriptions ---

  async createSubscription(data: CreateSubscriptionData): Promise<MqttSubscription> {
    const result = await sql`
      INSERT INTO mqtt_subscriptions (user_id, agent_id, topic, qos, prompt_template, conversation_mode, conversation_id, rate_limit_window_ms, rate_limit_max_triggers)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.topic}, ${data.qos ?? 0}, ${data.prompt_template}, ${data.conversation_mode ?? 'new'}, ${data.conversation_id ?? null}, ${data.rate_limit_window_ms ?? 60000}, ${data.rate_limit_max_triggers ?? 5})
      RETURNING *
    `;
    return result[0];
  }

  async deleteSubscription(agentId: number, topic: string): Promise<void> {
    await sql`
      DELETE FROM mqtt_subscriptions WHERE agent_id = ${agentId} AND topic = ${topic}
    `;
  }

  async deleteSubscriptionById(id: number): Promise<void> {
    await sql`DELETE FROM mqtt_subscriptions WHERE id = ${id}`;
  }

  async findSubscription(agentId: number, topic: string): Promise<MqttSubscription | null> {
    const result = await sql`
      SELECT * FROM mqtt_subscriptions WHERE agent_id = ${agentId} AND topic = ${topic}
    `;
    return result[0] || null;
  }

  async listSubscriptionsByAgent(agentId: number): Promise<MqttSubscription[]> {
    return await sql`
      SELECT * FROM mqtt_subscriptions WHERE agent_id = ${agentId}
      ORDER BY created_at DESC
    `;
  }

  async listEnabledSubscriptionsByUser(userId: number): Promise<MqttSubscription[]> {
    return await sql`
      SELECT * FROM mqtt_subscriptions WHERE user_id = ${userId} AND enabled = TRUE
      ORDER BY created_at ASC
    `;
  }

  async countSubscriptionsByUser(userId: number): Promise<number> {
    const result = await sql`
      SELECT COUNT(*)::int as count FROM mqtt_subscriptions WHERE user_id = ${userId}
    `;
    return result[0].count;
  }

  // --- Message buffer ---

  async storeMessage(userId: number, topic: string, payload: string | null, qos: number, retained: boolean): Promise<MqttMessage> {
    const now = Date.now();
    const result = await sql`
      INSERT INTO mqtt_messages (user_id, topic, payload, qos, retained, received_at)
      VALUES (${userId}, ${topic}, ${payload}, ${qos}, ${retained}, ${now})
      RETURNING *
    `;
    return result[0];
  }

  async getRecentMessages(userId: number, topic: string, limit: number): Promise<MqttMessage[]> {
    return await sql`
      SELECT * FROM mqtt_messages
      WHERE user_id = ${userId} AND topic = ${topic}
      ORDER BY received_at DESC
      LIMIT ${limit}
    `;
  }

  async pruneOldMessages(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const result = await sql`
      DELETE FROM mqtt_messages WHERE received_at < ${cutoff}
    `;
    return result.count ?? 0;
  }

  // --- Execution log ---

  async logExecution(data: {
    subscription_id: number;
    conversation_id?: number;
    mqtt_message_id?: number;
    status: 'running' | 'success' | 'error' | 'rate_limited';
    error_message?: string;
  }): Promise<MqttEventExecution> {
    const now = Date.now();
    const result = await sql`
      INSERT INTO mqtt_event_executions (subscription_id, conversation_id, mqtt_message_id, status, error_message, started_at)
      VALUES (${data.subscription_id}, ${data.conversation_id ?? null}, ${data.mqtt_message_id ?? null}, ${data.status}, ${data.error_message ?? null}, ${now})
      RETURNING *
    `;
    return result[0];
  }

  async updateExecution(id: number, data: {
    status: 'success' | 'error' | 'rate_limited';
    error_message?: string;
    completed_at?: number;
    conversation_id?: number;
  }): Promise<void> {
    const completedAt = data.completed_at ?? Date.now();
    if (data.conversation_id !== undefined) {
      await sql`
        UPDATE mqtt_event_executions
        SET status = ${data.status}, error_message = ${data.error_message ?? null},
            completed_at = ${completedAt}, conversation_id = ${data.conversation_id}
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE mqtt_event_executions
        SET status = ${data.status}, error_message = ${data.error_message ?? null},
            completed_at = ${completedAt}
        WHERE id = ${id}
      `;
    }
  }

  async countRecentExecutions(subscriptionId: number, windowMs: number): Promise<number> {
    const cutoff = Date.now() - windowMs;
    const result = await sql`
      SELECT COUNT(*)::int as count FROM mqtt_event_executions
      WHERE subscription_id = ${subscriptionId}
        AND started_at >= ${cutoff}
        AND status != 'rate_limited'
    `;
    return result[0].count;
  }
}
