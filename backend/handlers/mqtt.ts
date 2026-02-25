import type { BunRequest } from "bun";
import type { MqttRepository } from "../repositories/MqttRepository";
import type { User } from "../types/models";
import { encrypt } from "../utils/encryption";

interface MqttHandlerDependencies {
  mqttRepository: MqttRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
  getMqttStatus?: (userId: number) => { connected: boolean; error?: string };
  reconnectMqtt?: (userId: number) => Promise<void>;
  disconnectMqtt?: (userId: number) => Promise<void>;
}

export function createMqttHandlers(deps: MqttHandlerDependencies) {
  /**
   * GET /api/user/mqtt/broker
   */
  const getBrokerConfig = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const config = await deps.mqttRepository.getBrokerConfig(auth.user.id);
      if (!config) {
        return Response.json({ config: null });
      }

      // Return masked credentials
      return Response.json({
        config: {
          id: config.id,
          host: config.host,
          port: config.port,
          has_username: !!config.username,
          has_password: !!config.password,
          use_tls: config.use_tls,
          client_id: config.client_id,
          enabled: config.enabled,
          created_at: config.created_at,
          updated_at: config.updated_at,
        },
      });
    } catch (err) {
      console.error("Error getting MQTT broker config:", err);
      return Response.json({ error: "Failed to get broker config" }, { status: 500 });
    }
  };

  /**
   * PUT /api/user/mqtt/broker
   */
  const upsertBrokerConfig = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const body = await req.json();
      const { host, port, username, password, use_tls, client_id, enabled } = body;

      if (!host) {
        return Response.json({ error: "host is required" }, { status: 400 });
      }

      // Encrypt credentials if provided
      let encryptedUsername: string | null | undefined;
      let encryptedPassword: string | null | undefined;

      if (username !== undefined) {
        encryptedUsername = username
          ? await encrypt(username, deps.encryptionSecret)
          : null;
      }
      if (password !== undefined) {
        encryptedPassword = password
          ? await encrypt(password, deps.encryptionSecret)
          : null;
      }

      const config = await deps.mqttRepository.upsertBrokerConfig({
        user_id: auth.user.id,
        host,
        port: port ?? 1883,
        username: encryptedUsername,
        password: encryptedPassword,
        use_tls: use_tls ?? false,
        client_id: client_id ?? null,
        enabled: enabled ?? true,
      });

      return Response.json({
        config: {
          id: config.id,
          host: config.host,
          port: config.port,
          has_username: !!config.username,
          has_password: !!config.password,
          use_tls: config.use_tls,
          client_id: config.client_id,
          enabled: config.enabled,
          created_at: config.created_at,
          updated_at: config.updated_at,
        },
      });
    } catch (err) {
      console.error("Error upserting MQTT broker config:", err);
      return Response.json({ error: "Failed to save broker config" }, { status: 500 });
    }
  };

  /**
   * DELETE /api/user/mqtt/broker
   */
  const deleteBrokerConfig = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      // Disconnect MQTT client if service is available
      if (deps.disconnectMqtt) {
        await deps.disconnectMqtt(auth.user.id);
      }

      await deps.mqttRepository.deleteBrokerConfig(auth.user.id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting MQTT broker config:", err);
      return Response.json({ error: "Failed to delete broker config" }, { status: 500 });
    }
  };

  /**
   * GET /api/user/mqtt/status
   */
  const getStatus = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const status = deps.getMqttStatus
        ? deps.getMqttStatus(auth.user.id)
        : { connected: false };
      return Response.json(status);
    } catch (err) {
      console.error("Error getting MQTT status:", err);
      return Response.json({ error: "Failed to get status" }, { status: 500 });
    }
  };

  /**
   * POST /api/user/mqtt/reconnect
   */
  const reconnect = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      if (deps.reconnectMqtt) {
        await deps.reconnectMqtt(auth.user.id);
      }
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error reconnecting MQTT:", err);
      return Response.json({ error: "Failed to reconnect" }, { status: 500 });
    }
  };

  return {
    getBrokerConfig,
    upsertBrokerConfig,
    deleteBrokerConfig,
    getStatus,
    reconnect,
  };
}
