"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

export default function SettingsPage() {
  const { data: me, mutate } = useSWR("/api/auth/me", fetcher);
  const [step, setStep] = useState<"idle" | "setup" | "disable">("idle");
  const [qrB64, setQrB64] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function startSetup() {
    setError(""); setSuccess(""); setLoading(true);
    try {
      const res = await api("/api/auth/2fa/setup");
      setQrB64(res.qr_image_b64);
      setSecret(res.secret);
      setStep("setup");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start setup");
    } finally { setLoading(false); }
  }

  async function enableTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api("/api/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setSuccess("Two-factor authentication is now enabled.");
      setStep("idle"); setCode(""); setQrB64(""); setSecret("");
      mutate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setCode("");
    } finally { setLoading(false); }
  }

  async function disableTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api("/api/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setSuccess("Two-factor authentication has been disabled.");
      setStep("idle"); setCode("");
      mutate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setCode("");
    } finally { setLoading(false); }
  }

  const twoFaEnabled = me?.two_factor_enabled;

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-muted text-sm mb-8">Account security and preferences</p>

      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Two-factor authentication</div>
            <div className="text-sm text-muted mt-0.5">
              Require a code from your authenticator app on every login.
            </div>
            <div className={`text-xs mt-1 font-medium ${twoFaEnabled ? "text-good" : "text-muted"}`}>
              {twoFaEnabled ? "● Enabled" : "○ Disabled"}
            </div>
          </div>
          {step === "idle" && (
            twoFaEnabled
              ? <button onClick={() => { setStep("disable"); setError(""); setSuccess(""); }}
                  className="btn-danger shrink-0">Disable</button>
              : <button onClick={startSetup} disabled={loading}
                  className="btn shrink-0">{loading ? "…" : "Set up"}</button>
          )}
        </div>

        {success && (
          <div className="mt-4 text-good text-sm bg-good/10 border border-good/20 rounded-lg px-3 py-2">
            {success}
          </div>
        )}

        {/* ── Setup flow ── */}
        {step === "setup" && qrB64 && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted">
              Scan this QR code with <strong className="text-white">Google Authenticator</strong>,{" "}
              <strong className="text-white">Authy</strong>, or any TOTP app.
            </p>
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${qrB64}`} alt="2FA QR code"
                className="rounded-lg border border-border" width={200} height={200} />
            </div>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer hover:text-white">Can&apos;t scan? Enter code manually</summary>
              <code className="block mt-2 font-mono text-white break-all bg-panel px-3 py-2 rounded">{secret}</code>
            </details>
            <form onSubmit={enableTotp} className="space-y-3">
              <div>
                <label className="stat-label block mb-1">Enter the 6-digit code to confirm</label>
                <input
                  type="text" inputMode="numeric" autoComplete="one-time-code"
                  autoFocus maxLength={6}
                  className="input text-center text-xl tracking-widest"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
              {error && (
                <div className="text-bad text-sm bg-bad/10 border border-bad/20 rounded-lg px-3 py-2">{error}</div>
              )}
              <div className="flex gap-2">
                <button type="submit" disabled={loading || code.length !== 6}
                  className="btn flex-1 justify-center disabled:opacity-50">
                  {loading ? "…" : "Enable 2FA"}
                </button>
                <button type="button" onClick={() => { setStep("idle"); setError(""); setCode(""); }}
                  className="btn-ghost flex-1 justify-center">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Disable flow ── */}
        {step === "disable" && (
          <form onSubmit={disableTotp} className="mt-6 space-y-3">
            <p className="text-sm text-muted">
              Enter your current authenticator code to confirm disabling 2FA.
            </p>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code"
              autoFocus maxLength={6}
              className="input text-center text-xl tracking-widest"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
            {error && (
              <div className="text-bad text-sm bg-bad/10 border border-bad/20 rounded-lg px-3 py-2">{error}</div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={loading || code.length !== 6}
                className="btn-danger flex-1 justify-center disabled:opacity-50">
                {loading ? "…" : "Disable 2FA"}
              </button>
              <button type="button" onClick={() => { setStep("idle"); setError(""); setCode(""); }}
                className="btn-ghost flex-1 justify-center">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
