-- Database schema for Personal Assistant Army

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
    openai_api_key TEXT, -- Encrypted
    google_search_api_key TEXT, -- Encrypted
    google_search_engine_id TEXT,
    timezone VARCHAR(100) DEFAULT 'UTC', -- User's preferred timezone (IANA format)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MCP Servers (user-configured)
CREATE TABLE IF NOT EXISTS mcp_servers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    headers JSONB, -- Custom HTTP headers for MCP server requests
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    purpose TEXT,
    system_prompt TEXT NOT NULL,
    internet_search_enabled BOOLEAN DEFAULT FALSE,
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, slug)
);

-- Built-in tools
CREATE TABLE IF NOT EXISTS built_in_tools (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL -- 'memory', 'internet_search', etc.
);

-- Agent built-in tools (many-to-many)
CREATE TABLE IF NOT EXISTS agent_built_in_tools (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_id INTEGER NOT NULL REFERENCES built_in_tools(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, tool_id)
);

-- Agent MCP tools (many-to-many)
CREATE TABLE IF NOT EXISTS agent_mcp_tools (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    mcp_server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, mcp_server_id)
);

-- URL Tools (user-configured)
CREATE TABLE IF NOT EXISTS url_tools (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'GET', -- GET, POST, PUT, DELETE, PATCH
    headers JSONB, -- Custom HTTP headers
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Agent URL tools (many-to-many)
CREATE TABLE IF NOT EXISTS agent_url_tools (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    url_tool_id INTEGER NOT NULL REFERENCES url_tools(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, url_tool_id)
);

-- Agent handoffs (one-way relationships - transfer control)
CREATE TABLE IF NOT EXISTS agent_handoffs (
    id SERIAL PRIMARY KEY,
    from_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    to_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_agent_id, to_agent_id),
    CHECK(from_agent_id != to_agent_id)
);

-- Agent tools (one-way relationships - call other agents as tools)
CREATE TABLE IF NOT EXISTS agent_agent_tools (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, tool_agent_id),
    CHECK(agent_id != tool_agent_id)
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    raw_data JSONB, -- Full message object from OpenAI Agents SDK
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL, -- Which agent sent this (for handoffs)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions (for authentication)
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent memories (permanent storage for agents)
CREATE TABLE IF NOT EXISTS agent_memories (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON agents(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_id ON agent_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_key ON agent_memories(agent_id, key);
CREATE INDEX IF NOT EXISTS idx_agent_agent_tools_agent_id ON agent_agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_agent_tools_tool_agent_id ON agent_agent_tools(tool_agent_id);
CREATE INDEX IF NOT EXISTS idx_url_tools_user_id ON url_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_url_tools_agent_id ON agent_url_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_url_tools_url_tool_id ON agent_url_tools(url_tool_id);

-- Insert default built-in tools
INSERT INTO built_in_tools (name, description, type) VALUES
    ('permanent_memory', 'Stores and retrieves information permanently across conversations', 'memory'),
    ('internet_search', 'Searches the internet using Google Custom Search API', 'internet_search')
ON CONFLICT (name) DO NOTHING;

-- Migration: Add title column to conversations if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'conversations' AND column_name = 'title'
    ) THEN
        ALTER TABLE conversations ADD COLUMN title TEXT;
    END IF;
END $$;

-- Migration: Add raw_data column to messages if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'raw_data'
    ) THEN
        ALTER TABLE messages ADD COLUMN raw_data JSONB;
    END IF;
END $$;

-- Migration: Add headers column to mcp_servers if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'mcp_servers' AND column_name = 'headers'
    ) THEN
        ALTER TABLE mcp_servers ADD COLUMN headers JSONB;
    END IF;
END $$;

-- Migration: Add timezone column to users if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'timezone'
    ) THEN
        ALTER TABLE users ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC';
    END IF;
END $$;

-- Migration: Add is_favorite column to agents if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agents' AND column_name = 'is_favorite'
    ) THEN
        ALTER TABLE agents ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Skills (agent knowledge that can be loaded on-demand)
CREATE TABLE IF NOT EXISTS skills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE, -- NULL = user-level skill
    name VARCHAR(100) NOT NULL, -- slug format (e.g., 'email-drafting')
    summary TEXT NOT NULL, -- 1-2 sentences, injected into system prompt
    content TEXT NOT NULL, -- full Markdown instructions
    scope VARCHAR(10) NOT NULL DEFAULT 'agent', -- 'agent' | 'user'
    author VARCHAR(10) NOT NULL DEFAULT 'user', -- 'user' | 'agent'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_id, name),
    CHECK (scope IN ('agent', 'user')),
    CHECK (author IN ('user', 'agent')),
    CHECK (
        (scope = 'agent' AND agent_id IS NOT NULL) OR
        (scope = 'user' AND agent_id IS NULL)
    )
);

-- Per-agent skill enablement (for user-level skills)
CREATE TABLE IF NOT EXISTS agent_skills (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_agent_id ON skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_skills_scope ON skills(user_id, scope);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent_id ON agent_skills(agent_id);

-- Scheduled prompts
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    description TEXT,
    schedule_type VARCHAR(10) NOT NULL, -- 'once' | 'interval' | 'cron'
    schedule_value TEXT NOT NULL, -- ISO 8601 | milliseconds | cron expression
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    conversation_mode VARCHAR(10) NOT NULL DEFAULT 'new', -- 'new' | 'continue'
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    author VARCHAR(10) NOT NULL DEFAULT 'user', -- 'user' | 'agent'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at BIGINT, -- precomputed next execution time (epoch ms)
    last_run_at BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (schedule_type IN ('once', 'interval', 'cron')),
    CHECK (conversation_mode IN ('new', 'continue')),
    CHECK (author IN ('user', 'agent'))
);

-- Schedule execution log
CREATE TABLE IF NOT EXISTS schedule_executions (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL, -- 'running' | 'success' | 'error' | 'retry'
    error_message TEXT,
    started_at BIGINT, -- epoch ms
    completed_at BIGINT, -- epoch ms
    retry_count INTEGER DEFAULT 0
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    urgency VARCHAR(10) NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high'
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (urgency IN ('low', 'normal', 'high'))
);

-- Notification delivery log (email/webhook tracking)
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id SERIAL PRIMARY KEY,
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL, -- 'email' | 'webhook'
    status VARCHAR(10) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    CHECK (channel IN ('email', 'webhook', 'pushover')),
    CHECK (status IN ('pending', 'sent', 'failed'))
);

-- User notification settings
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_email VARCHAR(255),
    webhook_urls JSONB DEFAULT '[]',
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    pushover_user_key VARCHAR(50),
    pushover_api_token VARCHAR(50),
    pushover_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Per-agent notification muting
CREATE TABLE IF NOT EXISTS agent_notification_mutes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    muted_channels JSONB DEFAULT '["email", "webhook"]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_id)
);

-- Migration: Convert schedule timestamps to BIGINT (epoch ms) for timezone safety
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'schedules' AND column_name = 'next_run_at' AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE schedules
            ALTER COLUMN next_run_at TYPE BIGINT USING (EXTRACT(EPOCH FROM next_run_at) * 1000)::BIGINT,
            ALTER COLUMN last_run_at TYPE BIGINT USING (EXTRACT(EPOCH FROM last_run_at) * 1000)::BIGINT;
    END IF;
END $$;

-- Migration: Convert schedule_executions timestamps to BIGINT (epoch ms)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'schedule_executions' AND column_name = 'started_at' AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE schedule_executions
            ALTER COLUMN started_at DROP DEFAULT,
            ALTER COLUMN started_at TYPE BIGINT USING (EXTRACT(EPOCH FROM started_at) * 1000)::BIGINT,
            ALTER COLUMN completed_at TYPE BIGINT USING (EXTRACT(EPOCH FROM completed_at) * 1000)::BIGINT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule_id ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending ON notification_deliveries(status);

-- Migration: Add Pushover columns to notification settings
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'user_notification_settings' AND column_name = 'pushover_user_key'
    ) THEN
        ALTER TABLE user_notification_settings
            ADD COLUMN pushover_user_key VARCHAR(50),
            ADD COLUMN pushover_api_token VARCHAR(50),
            ADD COLUMN pushover_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- Migration: Add pushover_api_token if pushover columns already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'user_notification_settings' AND column_name = 'pushover_api_token'
    ) THEN
        ALTER TABLE user_notification_settings ADD COLUMN pushover_api_token VARCHAR(50);
    END IF;
END $$;

-- Migration: Update notification_deliveries channel CHECK to include pushover
DO $$
BEGIN
    ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
    ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('email', 'webhook', 'pushover'));
END $$;

-- Migration: Enable pgvector extension for semantic memory search
CREATE EXTENSION IF NOT EXISTS vector;

-- Migration: Add tiered memory columns to agent_memories
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agent_memories' AND column_name = 'tier'
    ) THEN
        ALTER TABLE agent_memories
            ADD COLUMN tier VARCHAR(10) NOT NULL DEFAULT 'working',
            ADD COLUMN author VARCHAR(10) NOT NULL DEFAULT 'agent',
            ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN last_accessed_at BIGINT NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Migration: Add embedding column (separate because vector type may not exist yet on first run)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agent_memories' AND column_name = 'embedding'
    ) THEN
        ALTER TABLE agent_memories ADD COLUMN embedding vector(1536);
    END IF;
END $$;

-- Migration: Add tier CHECK constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_memories_tier_check') THEN
        ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_tier_check
            CHECK (tier IN ('core', 'working', 'reference'));
    END IF;
END $$;

-- Migration: Backfill existing memories to working tier
UPDATE agent_memories SET
    last_accessed_at = EXTRACT(EPOCH FROM updated_at)::BIGINT * 1000
WHERE last_accessed_at = 0 AND updated_at IS NOT NULL;

-- Indexes for tiered memory queries
CREATE INDEX IF NOT EXISTS idx_agent_memories_tier ON agent_memories(agent_id, tier);
CREATE INDEX IF NOT EXISTS idx_agent_memories_lru ON agent_memories(agent_id, tier, last_accessed_at ASC);

-- MQTT broker configurations (one per user)
CREATE TABLE IF NOT EXISTS mqtt_broker_configs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 1883,
    username TEXT, -- Encrypted
    password TEXT, -- Encrypted
    use_tls BOOLEAN NOT NULL DEFAULT FALSE,
    client_id VARCHAR(255),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- MQTT subscriptions (per-agent topic subscriptions)
CREATE TABLE IF NOT EXISTS mqtt_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    topic VARCHAR(1024) NOT NULL,
    qos INTEGER NOT NULL DEFAULT 0,
    prompt_template TEXT NOT NULL, -- uses {topic} and {payload} placeholders
    conversation_mode VARCHAR(10) NOT NULL DEFAULT 'new', -- 'new' | 'continue'
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    rate_limit_window_ms BIGINT NOT NULL DEFAULT 60000, -- default 60s
    rate_limit_max_triggers INTEGER NOT NULL DEFAULT 5,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, topic),
    CHECK (conversation_mode IN ('new', 'continue')),
    CHECK (qos >= 0 AND qos <= 2)
);

-- MQTT messages (ring buffer of recent messages)
CREATE TABLE IF NOT EXISTS mqtt_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic VARCHAR(1024) NOT NULL,
    payload TEXT,
    qos INTEGER NOT NULL DEFAULT 0,
    retained BOOLEAN NOT NULL DEFAULT FALSE,
    received_at BIGINT NOT NULL -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_mqtt_messages_lookup ON mqtt_messages(user_id, topic, received_at DESC);

-- MQTT event executions (execution log)
CREATE TABLE IF NOT EXISTS mqtt_event_executions (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER NOT NULL REFERENCES mqtt_subscriptions(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    mqtt_message_id INTEGER REFERENCES mqtt_messages(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL, -- 'running' | 'success' | 'error' | 'rate_limited'
    error_message TEXT,
    started_at BIGINT, -- epoch ms
    completed_at BIGINT, -- epoch ms
    CHECK (status IN ('running', 'success', 'error', 'rate_limited'))
);

CREATE INDEX IF NOT EXISTS idx_mqtt_subscriptions_user ON mqtt_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_subscriptions_agent ON mqtt_subscriptions(agent_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_event_executions_sub ON mqtt_event_executions(subscription_id);

-- Seed MQTT built-in tool
INSERT INTO built_in_tools (name, description, type) VALUES
    ('mqtt', 'Publish and subscribe to MQTT topics for IoT and messaging', 'mqtt')
ON CONFLICT (name) DO NOTHING;

-- Migration: Add model column to agents for multi-provider support (Vercel AI SDK)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agents' AND column_name = 'model'
    ) THEN
        ALTER TABLE agents ADD COLUMN model VARCHAR(100) DEFAULT 'openai:gpt-4.1-mini';
    END IF;
END $$;

-- Migration: Add Anthropic and Google API key columns to users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'anthropic_api_key'
    ) THEN
        ALTER TABLE users ADD COLUMN anthropic_api_key TEXT; -- Encrypted
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'google_ai_api_key'
    ) THEN
        ALTER TABLE users ADD COLUMN google_ai_api_key TEXT; -- Encrypted
    END IF;
END $$;

-- Migration: Add pool_type column to agents for personal vs team pools
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agents' AND column_name = 'pool_type'
    ) THEN
        ALTER TABLE agents ADD COLUMN pool_type VARCHAR(10) NOT NULL DEFAULT 'personal';
    END IF;
END $$;

-- Migration: Add pool_type CHECK constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_pool_type_check') THEN
        ALTER TABLE agents ADD CONSTRAINT agents_pool_type_check
            CHECK (pool_type IN ('personal', 'team'));
    END IF;
END $$;

-- Migration: Add domain column to agents (email domain for team agents)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agents' AND column_name = 'domain'
    ) THEN
        ALTER TABLE agents ADD COLUMN domain VARCHAR(255);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_pool_type ON agents(pool_type);
CREATE INDEX IF NOT EXISTS idx_agents_team_domain ON agents(domain, pool_type) WHERE pool_type = 'team';

-- Unique constraint: team agent slugs must be unique within a domain
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_team_slug_domain ON agents(domain, slug) WHERE pool_type = 'team';

-- Team settings (API keys + timezone, keyed by domain)
CREATE TABLE IF NOT EXISTS team_settings (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) NOT NULL UNIQUE,
    openai_api_key TEXT,         -- Encrypted
    anthropic_api_key TEXT,      -- Encrypted
    google_ai_api_key TEXT,      -- Encrypted
    google_search_api_key TEXT,  -- Encrypted
    google_search_engine_id VARCHAR(255),
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Team MCP servers
CREATE TABLE IF NOT EXISTS team_mcp_servers (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    headers JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(domain, name)
);

-- Team URL tools
CREATE TABLE IF NOT EXISTS team_url_tools (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'GET',
    headers JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(domain, name)
);

-- Team notification settings
CREATE TABLE IF NOT EXISTS team_notification_settings (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) NOT NULL UNIQUE,
    notification_email VARCHAR(255),
    webhook_urls JSONB DEFAULT '[]',
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    pushover_user_key VARCHAR(50),
    pushover_api_token VARCHAR(50),
    pushover_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_mcp_servers_domain ON team_mcp_servers(domain);
CREATE INDEX IF NOT EXISTS idx_team_url_tools_domain ON team_url_tools(domain);
