"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await api(`/api/auth/${tab}`, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      login(res.token, res.user_id, res.username);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-4">

        <div className="text-center mb-10">
          <div className="text-4xl font-bold text-white tracking-tight">Ledger</div>
          <div className="text-sm text-muted mt-1">Personal &amp; Business Finance</div>
        </div>

        <div className="card p-8">
          <div className="flex gap-1 mb-7 bg-panel rounded-lg p-1">
            {(["login", "register"] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setError(""); }}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  tab === t
                    ? "bg-panel2 text-white shadow-sm border border-border"
                    : "text-muted hover:text-white"
                }`}>
                {t === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="stat-label block mb-1">Username</label>
              <input
                type="text" autoFocus autoComplete="username"
                className="input"
                placeholder="your-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="stat-label block mb-1">Password</label>
              <input
                type="password"
                autoComplete={tab === "register" ? "new-password" : "current-password"}
                className="input"
                placeholder={tab === "register" ? "Min. 6 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="text-bad text-sm bg-bad/10 border border-bad/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn w-full justify-center py-2.5 mt-2 disabled:opacity-50">
              {loading ? "…" : tab === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Self-hosted · Your data stays on your server
        </p>
      </div>
    </div>
  );
}
