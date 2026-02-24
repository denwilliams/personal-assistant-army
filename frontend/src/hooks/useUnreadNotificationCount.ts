import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export function useUnreadNotificationCount() {
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    try {
      const data = await api.notifications.getUnreadCount();
      setCount(data.count);
    } catch {
      // Silently ignore - notifications may not be available
    }
  }, []);

  useEffect(() => {
    refetch();

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        refetch();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [refetch]);

  return { count, refetch };
}
