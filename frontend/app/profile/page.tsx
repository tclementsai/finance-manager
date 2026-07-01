"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

export default function Profile() {
  const { data: me, mutate } = useSWR("/api/auth/me", fetcher);

  const [email, setEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  async function saveEmail() {
    setEmailErr(""); setEmailMsg("");
    if (!email.trim()) return;
    setSavingEmail(true);
    try {
      const res = await api("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEmailMsg(`Email updated to ${res.username}`);
      setEmail("");
      // Update stored username in localStorage so nav reflects new email
      localStorage.setItem("ledger.username", res.username);
      mutate();
    } catch (e: any) {
      setEmailErr(String(e.message || e));
    } finally {
      setSavingEmail(false);
    }
  }

  async function savePassword() {
    setPwErr(""); setPwMsg("");
    if (!currentPw || !newPw) return;
    if (newPw !== confirmPw) { setPwErr("New passwords don't match"); return; }
    if (newPw.length < 6) { setPwErr("Password must be at least 6 characters"); return; }
    setSavingPw(true);
    try {
      await api("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      setPwMsg("Password updated successfully");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (e: any) {
      setPwErr(String(e.message || e));
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-1">Profile</h1>
      <p className="text-muted text-sm mb-8">Manage your login email and password.</p>

      {/* Current info */}
      {me && (
        <div className="card mb-6">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">Signed in as</div>
          <div className="font-medium">{me.username}</div>
        </div>
      )}

      {/* Change email */}
      <div className="card mb-4">
        <div className="font-medium mb-4">Change email</div>
        <div className="mb-3">
          <div className="field-label mb-1">New email address</div>
          <input
            className="input"
            type="email"
            placeholder={me?.username ?? "your@email.com"}
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailMsg(""); setEmailErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && saveEmail()}
          />
        </div>
        {emailErr && <div className="text-bad text-sm mb-3">{emailErr}</div>}
        {emailMsg && <div className="text-good text-sm mb-3">{emailMsg}</div>}
        <button
          className="btn"
          onClick={saveEmail}
          disabled={savingEmail || !email.trim()}
        >
          {savingEmail ? "Saving…" : "Update email"}
        </button>
      </div>

      {/* Change password */}
      <div className="card">
        <div className="font-medium mb-4">Change password</div>
        <div className="space-y-3 mb-3">
          <div>
            <div className="field-label mb-1">Current password</div>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={currentPw}
              onChange={(e) => { setCurrentPw(e.target.value); setPwMsg(""); setPwErr(""); }}
            />
          </div>
          <div>
            <div className="field-label mb-1">New password</div>
            <input
              className="input"
              type="password"
              placeholder="Min. 6 characters"
              value={newPw}
              onChange={(e) => { setNewPw(e.target.value); setPwMsg(""); setPwErr(""); }}
            />
          </div>
          <div>
            <div className="field-label mb-1">Confirm new password</div>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setPwMsg(""); setPwErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && savePassword()}
            />
          </div>
        </div>
        {pwErr && <div className="text-bad text-sm mb-3">{pwErr}</div>}
        {pwMsg && <div className="text-good text-sm mb-3">{pwMsg}</div>}
        <button
          className="btn"
          onClick={savePassword}
          disabled={savingPw || !currentPw || !newPw || !confirmPw}
        >
          {savingPw ? "Saving…" : "Update password"}
        </button>
      </div>
    </div>
  );
}
