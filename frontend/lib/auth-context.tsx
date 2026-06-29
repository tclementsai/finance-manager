"use client";
import { createContext, useContext, useEffect, useState } from "react";

type AuthState = {
  token: string | null;
  userId: number | null;
  username: string | null;
};

type AuthCtx = AuthState & {
  login: (token: string, userId: number, username: string) => void;
  logout: () => void;
  ready: boolean;
};

const Ctx = createContext<AuthCtx>({
  token: null, userId: null, username: null,
  login: () => {}, logout: () => {}, ready: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, userId: null, username: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("ledger.token");
    const userId = localStorage.getItem("ledger.userId");
    const username = localStorage.getItem("ledger.username");
    if (token && userId) {
      setState({ token, userId: Number(userId), username });
    }
    setReady(true);
  }, []);

  function login(token: string, userId: number, username: string) {
    localStorage.setItem("ledger.token", token);
    localStorage.setItem("ledger.userId", String(userId));
    localStorage.setItem("ledger.username", username);
    setState({ token, userId, username });
  }

  function logout() {
    localStorage.removeItem("ledger.token");
    localStorage.removeItem("ledger.userId");
    localStorage.removeItem("ledger.username");
    setState({ token: null, userId: null, username: null });
  }

  return <Ctx.Provider value={{ ...state, login, logout, ready }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
