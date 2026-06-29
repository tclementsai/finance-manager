"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

type Step = "credentials" | "business" | "twofa" | "done";

const STEPS: Step[] = ["credentials", "business", "twofa", "done"];
const STEP_LABELS = ["Account", "Business", "Security", "Done"];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.slice(0, -1).map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
            i < idx ? "bg-accent border-accent text-white" :
            i === idx ? "border-accent text-accent" :
            "border-border text-muted"
          }`}>
            {i < idx ? "✓" : i + 1}
          </div>
          <span className={`text-xs hidden sm:block ${i === idx ? "text-white" : "text-muted"}`}>
            {STEP_LABELS[i]}
          </span>
          {i < STEPS.length - 2 && <div className={`w-8 h-px ${i < idx ? "bg-accent" : "bg-border"}`} />}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="text-bad text-sm bg-bad/10 border border-bad/20 rounded-lg px-3 py-2">{msg}</div>
  );
}

export default function SignupPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");

  // Step 1
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Step 2
  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState("sole_trader");
  const [abn, setAbn] = useState("");
  const [gstRegistered, setGstRegistered] = useState(false);

  // Step 3
  const [qrB64, setQrB64] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [twofaEnabled, setTwofaEnabled] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setError(""); setLoading(true);
    try {
      const res = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      login(res.token, res.user_id, res.username);
      setStep("business");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally { setLoading(false); }
  }

  async function submitBusiness(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api("/api/entities", {
        method: "POST",
        body: JSON.stringify({
          name: entityName.trim(),
          type: entityType,
          gst_registered: gstRegistered,
          abn: abn.trim() || null,
        }),
      });
      const setup = await api("/api/auth/2fa/setup");
      setQrB64(setup.qr_image_b64);
      setTotpSecret(setup.secret);
      setStep("twofa");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save business");
    } finally { setLoading(false); }
  }

  async function enable2FA(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api("/api/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code: totpCode.trim() }),
      });
      setTwofaEnabled(true);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code — check your app and try again");
      setTotpCode("");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="text-4xl font-bold text-white tracking-tight">Ledger</div>
          <div className="text-sm text-muted mt-1">Account Setup</div>
        </div>

        <StepIndicator current={step} />

        {step === "credentials" && (
          <div className="card p-8">
            <h2 className="text-lg font-semibold mb-1">Create your account</h2>
            <p className="text-sm text-muted mb-6">Choose a username and password.</p>
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label className="stat-label block mb-1">Username</label>
                <input type="text" autoFocus autoComplete="username" className="input"
                  placeholder="e.g. alex.smith"
                  value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div>
                <label className="stat-label block mb-1">Password</label>
                <input type="password" autoComplete="new-password" className="input"
                  placeholder="Min. 6 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div>
                <label className="stat-label block mb-1">Confirm password</label>
                <input type="password" autoComplete="new-password" className="input"
                  placeholder="Repeat password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              {error && <ErrorBox msg={error} />}
              <button type="submit" disabled={loading}
                className="btn w-full justify-center py-2.5 mt-2 disabled:opacity-50">
                {loading ? "…" : "Continue →"}
              </button>
            </form>
            <p className="text-center text-xs text-muted mt-5">
              Already have an account?{" "}
              <a href="/login" className="text-accent hover:underline">Sign in</a>
            </p>
          </div>
        )}

        {step === "business" && (
          <div className="card p-8">
            <h2 className="text-lg font-semibold mb-1">Set up your first business</h2>
            <p className="text-sm text-muted mb-6">
              You can add more entities later from the Businesses page.
            </p>
            <form onSubmit={submitBusiness} className="space-y-4">
              <div>
                <label className="stat-label block mb-1">Business / trading name</label>
                <input type="text" autoFocus className="input"
                  placeholder="e.g. Alex Smith Consulting"
                  value={entityName} onChange={(e) => setEntityName(e.target.value)} required />
              </div>
              <div>
                <label className="stat-label block mb-1">Structure</label>
                <select className="input" value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}>
                  <option value="sole_trader">Sole Trader</option>
                  <option value="company">Company (Pty Ltd)</option>
                  <option value="personal">Personal / Individual</option>
                </select>
              </div>
              <div>
                <label className="stat-label block mb-1">
                  ABN <span className="normal-case text-muted font-normal">(optional)</span>
                </label>
                <input type="text" className="input" placeholder="12 345 678 901"
                  value={abn} onChange={(e) => setAbn(e.target.value)} />
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-accent"
                  checked={gstRegistered}
                  onChange={(e) => setGstRegistered(e.target.checked)} />
                <span className="text-sm">Registered for GST</span>
              </label>
              {error && <ErrorBox msg={error} />}
              <button type="submit" disabled={loading}
                className="btn w-full justify-center py-2.5 mt-2 disabled:opacity-50">
                {loading ? "…" : "Continue →"}
              </button>
            </form>
          </div>
        )}

        {step === "twofa" && (
          <div className="card p-8">
            <h2 className="text-lg font-semibold mb-1">Secure your account</h2>
            <p className="text-sm text-muted mb-5">
              Set up two-factor authentication to protect your financial data. Scan the QR code with{" "}
              <strong className="text-white">Google Authenticator</strong> or{" "}
              <strong className="text-white">Authy</strong>.
            </p>
            {qrB64 && (
              <div className="flex justify-center mb-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/png;base64,${qrB64}`} alt="2FA QR code"
                  className="rounded-xl border border-border bg-white p-2" width={180} height={180} />
              </div>
            )}
            <details className="text-xs text-muted mb-5">
              <summary className="cursor-pointer hover:text-white">
                Can&apos;t scan? Enter the code manually
              </summary>
              <code className="block mt-2 font-mono text-white break-all bg-panel px-3 py-2 rounded">
                {totpSecret}
              </code>
            </details>
            <form onSubmit={enable2FA} className="space-y-4">
              <div>
                <label className="stat-label block mb-1">Enter the 6-digit code to confirm</label>
                <input type="text" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} autoFocus
                  className="input text-center text-2xl tracking-widest"
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  required />
              </div>
              {error && <ErrorBox msg={error} />}
              <button type="submit" disabled={loading || totpCode.length !== 6}
                className="btn w-full justify-center py-2.5 disabled:opacity-50">
                {loading ? "…" : "Enable 2FA →"}
              </button>
            </form>
            <button onClick={() => setStep("done")}
              className="w-full text-center text-sm text-muted hover:text-white mt-4 py-1">
              Skip for now — I&apos;ll set this up later in Settings
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="card p-8 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-semibold mb-2">You&apos;re all set</h2>
            <div className="text-sm text-muted space-y-1 mb-6">
              <p>Signed in as <strong className="text-white">{username}</strong></p>
              <p>Business: <strong className="text-white">{entityName}</strong></p>
              <p>
                2FA:{" "}
                <strong className={twofaEnabled ? "text-good" : "text-muted"}>
                  {twofaEnabled ? "Enabled ✓" : "Not configured"}
                </strong>
              </p>
            </div>
            <button onClick={() => router.push("/")} className="btn px-8 py-2.5">
              Go to Dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
