"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, createContext, useContext, type ReactNode } from "react";

// ── Auth Context ────────────────────────────────────────
interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "patient" | "doctor" | "admin";
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, refreshToken: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── API helper ──────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function apiFetch(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOptions.headers as Record<string, string> || {}),
  };

  const cleanApiUrl = API_URL.replace(/\/+$/, "");
  const res = await fetch(`${cleanApiUrl}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ title: "Request failed" }));
    throw { status: res.status, ...error };
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Providers ───────────────────────────────────────────
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            retry: 1,
          },
        },
      })
  );

  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("auth_user");
    return stored ? JSON.parse(stored) : null;
  });

  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("auth_token");
  });

  const login = (accessToken: string, refreshToken: string, authUser: AuthUser) => {
    setToken(accessToken);
    setUser(authUser);
    localStorage.setItem("auth_token", accessToken);
    localStorage.setItem("auth_refresh", refreshToken);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_refresh");
    localStorage.removeItem("auth_user");
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}
