import React, { createContext, useContext, useState, useEffect } from "react";
import { api } from "../lib/api";

interface User {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
  has_openai_key: boolean;
  has_google_search_key: boolean;
  google_search_engine_id?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = async () => {
    try {
      setLoading(true);
      setError(null);
      const profile = await api.user.getProfile();
      setUser(profile);
    } catch (err) {
      // Not logged in or session expired
      setUser(null);
      if (err instanceof Error && !err.message.includes("Unauthorized")) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const login = () => {
    api.auth.login();
  };

  const logout = async () => {
    try {
      await api.auth.logout();
      setUser(null);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  const value = {
    user,
    loading,
    error,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
