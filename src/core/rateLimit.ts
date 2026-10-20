// Rate-limit handling shared by the Worker proxy and the client. Header names and the backoff formula follow
// PoB2's TradeQueryRateLimiter.lua / TradeQueryRequests.lua (MIT). Live header values are UNVERIFIED.

export interface Bucket { requests: number; window: number; timeout: number }
export interface RuleState { limits: Bucket[]; state: Bucket[] }
export interface RatePolicy { name?: string; rules: Record<string, RuleState>; retryAfter?: number }

const parseBuckets = (v: string | undefined): Bucket[] =>
  (v ?? "").split(",").filter(Boolean).map((b) => {
    const [requests, window, timeout] = b.split(":").map(Number);
    return { requests: requests ?? 0, window: window ?? 0, timeout: timeout ?? 0 };
  });

/** Parse X-Rate-Limit-* and Retry-After from lower-cased headers. */
export function parseRateHeaders(h: Record<string, string>): RatePolicy {
  const policy: RatePolicy = { rules: {} };
  if (h["x-rate-limit-policy"]) policy.name = h["x-rate-limit-policy"];
  if (h["retry-after"] !== undefined && Number.isFinite(Number(h["retry-after"]))) policy.retryAfter = Number(h["retry-after"]);
  for (const rule of (h["x-rate-limit-rules"] ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)) {
    policy.rules[rule] = {
      limits: parseBuckets(h[`x-rate-limit-${rule}`]),
      state: parseBuckets(h[`x-rate-limit-${rule}-state`]),
    };
  }
  return policy;
}

/** 429 backoff: max(min(2^attempt, 60), Retry-After) seconds, in ms. Attempt starts at 1. */
export function backoffMs(attempt: number, retryAfterSeconds = 0): number {
  return Math.max(Math.min(2 ** attempt, 60), retryAfterSeconds) * 1000;
}

/** Sliding-window limiter per policy. Keeps `margin` requests of headroom under every limit. */
export class RateLimiter {
  private limits = new Map<string, Bucket[]>();
  private stamps = new Map<string, number[]>();
  private blockedUntil = new Map<string, number>();
  constructor(private margin = 1, private now: () => number = () => Date.now()) {}

  /** Learn limits (and external usage) from a response. */
  update(policy: string, headers: Record<string, string>): void {
    const p = parseRateHeaders(headers);
    const all = Object.values(p.rules);
    if (all.length) this.limits.set(policy, all.flatMap((r) => r.limits));
    const ts = this.stamps.get(policy) ?? [];
    for (const r of all) {
      for (const s of r.state) {
        // Server saw more requests in this window than we did: others share the limit. Pad local history.
        const mine = ts.filter((t) => t > this.now() - s.window * 1000).length;
        for (let i = mine; i < s.requests; i++) ts.push(this.now());
      }
    }
    this.stamps.set(policy, ts);
    if (p.retryAfter) this.blockedUntil.set(policy, this.now() + p.retryAfter * 1000);
  }

  /** Milliseconds to wait before the next request is allowed (0 = go). */
  waitMs(policy: string): number {
    const now = this.now();
    let wait = Math.max(0, (this.blockedUntil.get(policy) ?? 0) - now);
    const ts = (this.stamps.get(policy) ?? []).filter((t) => t > now - 3_600_000);
    this.stamps.set(policy, ts);
    for (const b of this.limits.get(policy) ?? []) {
      const cap = Math.max(1, b.requests - this.margin);
      const inWin = ts.filter((t) => t > now - b.window * 1000).sort((a, c) => a - c);
      if (inWin.length >= cap) wait = Math.max(wait, inWin[inWin.length - cap]! + b.window * 1000 - now);
    }
    return wait;
  }

  record(policy: string): void {
    const ts = this.stamps.get(policy) ?? [];
    ts.push(this.now());
    this.stamps.set(policy, ts);
  }
}
