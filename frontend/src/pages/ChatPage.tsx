import React, { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agent_id?: number;
  created_at: string;
  isStreaming?: boolean;
  agentName?: string;
  toolName?: string; // For tool role messages
}

interface Agent {
  id: number;
  slug: string;
  name: string;
  purpose?: string;
}

export default function ChatPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (slug) {
      loadAgent();
    }
  }, [slug]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadAgent = async () => {
    try {
      setLoading(true);
      const agentData = await api.agents.get(slug!);
      setAgent(agentData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent");
      setTimeout(() => navigate("/agents"), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !agent || !slug) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    // Create placeholder for assistant message
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      agent_id: agent.id,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      await api.chat.sendMessageStream(
        slug,
        userMessage.content,
        conversationId,
        (chunk) => {
          if (chunk.type === "init" && chunk.conversation_id) {
            setConversationId(chunk.conversation_id);
          } else if (chunk.type === "started") {
            // Agent started processing
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, isStreaming: true }
                  : msg
              )
            );
          } else if (chunk.type === "text" && chunk.content) {
            // Append text to assistant message
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: msg.content + chunk.content, isStreaming: true }
                  : msg
              )
            );
          } else if (chunk.type === "tool_call") {
            console.log("🔧 Tool call received:", chunk);

            // Backend sends 'name' field, not 'content'
            const toolName = chunk.name || chunk.content;
            if (toolName) {
              // Add a tool call status message before the assistant message
              const toolMessage: Message = {
                id: crypto.randomUUID(),
                role: "tool",
                content: "",
                toolName: toolName,
                created_at: new Date().toISOString(),
              };

              setMessages((prev) => {
                // Find the assistant message and insert tool message before it
                const assistantIndex = prev.findIndex(msg => msg.id === assistantMessageId);
                if (assistantIndex !== -1) {
                  const newMessages = [...prev];
                  newMessages.splice(assistantIndex, 0, toolMessage);
                  return newMessages;
                }
                return prev;
              });
            }
          } else if (chunk.type === "agent_update" && chunk.agent) {
            // Show agent handoff
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, agentName: chunk.agent.name, isStreaming: true }
                  : msg
              )
            );
          } else if (chunk.type === "stopped") {
            // Stream finished
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, isStreaming: false }
                  : msg
              )
            );
            setLoading(false);
          } else if (chunk.type === "error") {
            setError("Failed to send message");
            setLoading(false);
          }
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="bg-card rounded-lg shadow p-6 max-w-md">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Error</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Link to="/agents">
            <Button>Back to Agents</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-foreground mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading agent...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border flex-shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/agents">
                <Button variant="outline" size="sm">
                  ← Back
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-foreground">{agent.name}</h1>
                {agent.purpose && (
                  <p className="text-sm text-muted-foreground">{agent.purpose}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Link to="/profile">
                <Button variant="outline" size="sm">
                  Profile
                </Button>
              </Link>
              <Link to="/">
                <Button variant="outline" size="sm">
                  Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">💬</div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Start a conversation
              </h2>
              <p className="text-muted-foreground">
                Ask {agent.name} anything to get started
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === "user" ? "flex justify-end" : ""}
                >
                  {message.role === "user" ? (
                    // User message - compact bubble on right
                    <div className="max-w-2xl rounded-2xl px-4 py-2.5 bg-muted text-foreground">
                      <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                    </div>
                  ) : message.role === "tool" ? (
                    // Tool call status message
                    <div className="text-xs text-muted-foreground italic py-2">
                      🔧 Using tool: {message.toolName}
                    </div>
                  ) : (
                    // Assistant message - full width
                    <div className="w-full">
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        {message.agentName || agent.name}
                      </div>
                      <div className="prose prose-slate dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                        {message.isStreaming && (
                          <span className="inline-block w-1.5 h-5 bg-muted-foreground animate-pulse ml-0.5 align-middle"></span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card flex-shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${agent.name}...`}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground disabled:bg-muted disabled:text-muted-foreground"
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              {loading ? "Sending..." : "Send"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
