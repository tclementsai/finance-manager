export const fetcher = (url: string) => fetch(url).then((r) => r.json());

export async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    // FastAPI errors come back as {"detail": "..."} — surface just the message.
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
