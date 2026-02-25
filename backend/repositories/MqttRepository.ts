import type { MqttBrokerConfig, MqttSubscription, MqttMessage, MqttEventExecution } from "../types/models";

export interface UpsertBrokerConfigData {
  user_id: number;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  use_tls: boolean;
  client_id?: string | null;
  enabled?: boolean;
}

export interface CreateSubscriptionData {
  user_id: number;
  agent_id: number;
  topic: string;
  qos?: number;
  prompt_template: string;
  conversation_mode?: 'new' | 'continue';
  conversation_id?: number;
  rate_limit_window_ms?: number;
  rate_limit_max_triggers?: number;
}

export interface MqttRepository {
  // Broker config
  getBrokerConfig(userId: number): Promise<MqttBrokerConfig | null>;
  upsertBrokerConfig(data: UpsertBrokerConfigData): Promise<MqttBrokerConfig>;
  deleteBrokerConfig(userId: number): Promise<void>;
  listEnabledBrokerConfigs(): Promise<MqttBrokerConfig[]>;

  // Subscriptions
  createSubscription(data: CreateSubscriptionData): Promise<MqttSubscription>;
  deleteSubscription(agentId: number, topic: string): Promise<void>;
  deleteSubscriptionById(id: number): Promise<void>;
  findSubscription(agentId: number, topic: string): Promise<MqttSubscription | null>;
  listSubscriptionsByAgent(agentId: number): Promise<MqttSubscription[]>;
  listEnabledSubscriptionsByUser(userId: number): Promise<MqttSubscription[]>;
  countSubscriptionsByUser(userId: number): Promise<number>;

  // Message buffer
  storeMessage(userId: number, topic: string, payload: string | null, qos: number, retained: boolean): Promise<MqttMessage>;
  getRecentMessages(userId: number, topic: string, limit: number): Promise<MqttMessage[]>;
  pruneOldMessages(maxAgeMs: number): Promise<number>;

  // Execution log
  logExecution(data: {
    subscription_id: number;
    conversation_id?: number;
    mqtt_message_id?: number;
    status: 'running' | 'success' | 'error' | 'rate_limited';
    error_message?: string;
  }): Promise<MqttEventExecution>;

  updateExecution(id: number, data: {
    status: 'success' | 'error' | 'rate_limited';
    error_message?: string;
    completed_at?: number;
    conversation_id?: number;
  }): Promise<void>;

  countRecentExecutions(subscriptionId: number, windowMs: number): Promise<number>;
}
