import React, { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent_id?: number;
  created_at: string;
  isStreaming?: boolean;
  toolCall?: string;
  agentName?: string;
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
          } else if (chunk.type === "tool_call" && chunk.content) {
            // Show tool call indicator
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, toolCall: chunk.content, isStreaming: true }
                  : msg
              )
            );
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-6 max-w-md">
          <h2 className="text-lg font-semibold text-red-600 mb-2">Error</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <Link to="/agents">
            <Button>Back to Agents</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading agent...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/agents">
                <Button variant="outline" size="sm">
                  ← Back
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{agent.name}</h1>
                {agent.purpose && (
                  <p className="text-sm text-slate-600">{agent.purpose}</p>
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
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Start a conversation
              </h2>
              <p className="text-slate-600">
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
                    <div className="max-w-2xl rounded-2xl px-4 py-2.5 bg-slate-100 text-slate-900">
                      <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                    </div>
                  ) : (
                    // Assistant message - full width
                    <div className="w-full">
                      <div className="text-xs font-medium text-slate-500 mb-2">
                        {message.agentName || agent.name}
                      </div>
                      {message.toolCall && (
                        <div className="text-xs italic text-slate-400 mb-2">
                          🔧 Using tool: {message.toolCall}
                        </div>
                      )}
                      <div className="prose prose-slate max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                        {message.isStreaming && (
                          <span className="inline-block w-1.5 h-5 bg-slate-400 animate-pulse ml-0.5 align-middle"></span>
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
      <div className="border-t border-slate-200 bg-white flex-shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${agent.name}...`}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
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
