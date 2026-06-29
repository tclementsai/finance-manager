function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ledger.token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const fetcher = (url: string) =>
  fetch(url, { headers: authHeaders() }).then((r) => {
    if (r.status === 401) return null;
    return r.json();
  });

export async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("ledger.token");
      localStorage.removeItem("ledger.userId");
      localStorage.removeItem("ledger.username");
      window.location.href = "/login";
    }
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.detail) message = typeof parsed.detail === "string"
        ? parsed.detail
        : JSON.stringify(parsed.detail);
    } catch {}
    throw new Error(message || `Request failed (${res.status})`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const money = (cents: number | null | undefined) =>
  ((cents ?? 0) / 100).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
  });

export const moneyShort = (cents: number | null | undefined) =>
  "$" + ((cents ?? 0) / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });
