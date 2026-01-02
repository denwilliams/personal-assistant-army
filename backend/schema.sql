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

-- Agent handoffs (one-way relationships)
CREATE TABLE IF NOT EXISTS agent_handoffs (
    id SERIAL PRIMARY KEY,
    from_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    to_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_agent_id, to_agent_id),
    CHECK(from_agent_id != to_agent_id)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON agents(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

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
        WHERE table_name = 'conversations' AND column_name = 'title'
    ) THEN
        ALTER TABLE conversations ADD COLUMN title TEXT;
    END IF;
END $$;

-- Migration: Add raw_data column to messages if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'raw_data'
    ) THEN
        ALTER TABLE messages ADD COLUMN raw_data JSONB;
    END IF;
END $$;

-- Migration: Add headers column to mcp_servers if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mcp_servers' AND column_name = 'headers'
    ) THEN
        ALTER TABLE mcp_servers ADD COLUMN headers JSONB;
    END IF;
END $$;

-- Migration: Add timezone column to users if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'timezone'
    ) THEN
        ALTER TABLE users ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC';
    END IF;
END $$;
