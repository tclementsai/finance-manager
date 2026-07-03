"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (res.two_factor_required) {
        setPendingToken(res.pending_token);
      } else {
        login(res.token, res.user_id, res.username);
        router.push("/");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await api("/api/auth/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ pending_token: pendingToken, code: totpCode.trim() }),
      });
      login(res.token, res.user_id, res.username);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setTotpCode("");
    } finally { setLoading(false); }
  }

  if (pendingToken) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-sm px-4">
          <div className="text-center mb-10">
            <div className="text-4xl font-bold text-white tracking-tight">Ledger</div>
            <div className="text-sm text-muted mt-1">Two-factor authentication</div>
          </div>
          <div className="card p-8">
            <p className="text-sm text-muted mb-6 text-center">
              Enter the 6-digit code from your authenticator app.
            </p>
            <form onSubmit={submitTotp} className="space-y-4">
              <input type="text" inputMode="numeric" autoComplete="one-time-code"
                autoFocus maxLength={6}
                className="input text-center text-2xl tracking-widest"
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                required />
              {error && <ErrorBox msg={error} />}
              <button type="submit" disabled={loading || totpCode.length !== 6}
                className="btn w-full justify-center py-2.5 disabled:opacity-50">
                {loading ? "…" : "Verify"}
              </button>
              <button type="button"
                onClick={() => { setPendingToken(null); setError(""); }}
                className="w-full text-center text-sm text-muted hover:text-white">
                ← Back to login
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        <div className="text-center mb-10">
          <div className="text-4xl font-bold text-white tracking-tight">Ledger</div>
          <div className="text-sm text-muted mt-1">Personal &amp; Business Finance</div>
        </div>

        <div className="card p-8">
          {sessionExpired && (
            <div className="text-warn text-sm bg-warn/10 border border-warn/20 rounded-lg px-3 py-2 mb-5">
              Your session expired — please sign in again.
            </div>
          )}
          <h2 className="text-base font-semibold mb-6">Sign in</h2>
          <form onSubmit={submitCredentials} className="space-y-4">
            <div>
              <label className="stat-label block mb-1">Username</label>
              <input type="text" autoFocus autoComplete="username" className="input"
                placeholder="your-username"
                value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="stat-label block mb-1">Password</label>
              <input type="password" autoComplete="current-password" className="input"
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <ErrorBox msg={error} />}
            <button type="submit" disabled={loading}
              className="btn w-full justify-center py-2.5 mt-2 disabled:opacity-50">
              {loading ? "…" : "Sign In"}
            </button>
          </form>
          <p className="text-center text-sm text-muted mt-6">
            New to Ledger?{" "}
            <a href="/signup" className="text-accent hover:underline">Create an account</a>
          </p>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Self-hosted · Your data stays on your server
        </p>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="text-bad text-sm bg-bad/10 border border-bad/20 rounded-lg px-3 py-2">{msg}</div>
  );
}
