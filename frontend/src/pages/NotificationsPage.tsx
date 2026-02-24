import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { api, type AppNotification } from "../lib/api";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 20;

  useEffect(() => {
    loadNotifications(true);
  }, [filter]);

  const loadNotifications = async (reset = false) => {
    try {
      setLoading(true);
      const newOffset = reset ? 0 : offset;
      const data = await api.notifications.list({
        unread: filter === "unread" ? true : undefined,
        limit: LIMIT,
        offset: newOffset,
      });
      if (reset) {
        setNotifications(data.notifications);
        setOffset(LIMIT);
      } else {
        setNotifications((prev) => [...prev, ...data.notifications]);
        setOffset(newOffset + LIMIT);
      }
      setHasMore(data.notifications.length === LIMIT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (notification: AppNotification) => {
    if (notification.read) return;
    try {
      await api.notifications.markRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as read");
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.notifications.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark all as read");
    }
  };

  const handleClick = (notification: AppNotification) => {
    handleMarkRead(notification);
    if (notification.conversation_id) {
      // Navigate to agent chat — we need the agent slug, which we may not have
      // For now, just mark as read
    }
  };

  const urgencyDot = (urgency: string) => {
    switch (urgency) {
      case "low": return "bg-green-500";
      case "normal": return "bg-blue-500";
      case "high": return "bg-red-500";
      default: return "bg-muted-foreground";
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Notifications</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-input">
            <button
              className={`px-3 py-1 text-sm rounded-l-md transition-colors ${
                filter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              className={`px-3 py-1 text-sm rounded-r-md transition-colors ${
                filter === "unread"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
              onClick={() => setFilter("unread")}
            >
              Unread
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            Mark All Read
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mx-6 mt-6">
            <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {loading && notifications.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`px-6 py-4 hover:bg-muted/50 cursor-pointer transition-colors ${
                  !notification.read ? "bg-accent/30" : ""
                }`}
                onClick={() => handleClick(notification)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${urgencyDot(
                      notification.urgency
                    )}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {notification.agent_name && (
                        <span className="text-sm font-medium text-foreground">
                          {notification.agent_name}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(notification.created_at)}
                      </span>
                      {!notification.read && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{notification.message}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && notifications.length > 0 && (
          <div className="px-6 py-4 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadNotifications(false)}
              disabled={loading}
            >
              {loading ? "Loading..." : "Load More"}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
