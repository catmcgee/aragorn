// @aragorn/sdk — typed client for the Ring /v1 API (BUILD_SPEC §6.2).
// The institutional integration surface: everything the dashboard does goes through here,
// and CI drives full flows through this client alone (API-first invariant).

export interface Me {
  user: { email: string; role: string };
  limitMicro: string | null;
  allowedParties: string[] | null;
  org: string;
  ens: string | null;
  enabledModules: string[];
  capabilities: string[];
  explorerBase?: string | null;
}

export interface Portfolio {
  org: string;
  balances: Record<string, string>;
}

export interface ContractRow {
  cid: string;
  template_id: number;
  payload: Record<string, string>;
  status: "active" | "pending_consume" | "consumed";
  owner_party: string | null;
  leaf_index: number | null;
  created_tx: string | null;
  consumed_tx: string | null;
  amount_micro: string | null;
}

export interface TransferResult {
  txid?: string;
  cid?: string;
  status?: "pending_approval";
  approvalId?: number;
  workflowId?: number;
}

export interface Approval {
  id: number;
  workflow_id: number;
  requested_by: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
  approver: string | null;
  reason: string | null;
  workflow_state: Record<string, unknown>;
  workflow_kind: string;
  ts: string;
}

export interface RingEvent {
  type: string;
  [k: string]: unknown;
}

export class RingApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Pull the innermost human-readable string out of a possibly-nested error payload.
 *  Ring/Privy errors arrive as `{"error":"..."}`, sometimes double-encoded as a JSON
 *  string, and sometimes wrapped in a `prefix: {json}` shape from a fetch helper. */
function unwrapErrorMessage(raw: string): string {
  let msg = raw.trim();
  // Strip a leading `something/path: ` or `prefix: ` before a JSON/text body.
  // Only strip when the remainder looks like a body (starts with { or a quote).
  const sep = msg.indexOf(": ");
  if (sep > 0) {
    const rest = msg.slice(sep + 2).trim();
    if (rest.startsWith("{") || rest.startsWith('"') || rest.startsWith("[")) {
      msg = rest;
    }
  }
  // Unwrap nested JSON `{"error": ...}` up to a few levels (handles double-encoding).
  for (let i = 0; i < 4; i++) {
    const t = msg.trim();
    if (!(t.startsWith("{") || t.startsWith('"'))) break;
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === "string") {
        msg = parsed;
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const inner =
          (parsed as any).error ?? (parsed as any).message ?? (parsed as any).detail;
        if (typeof inner === "string") {
          msg = inner;
          continue;
        }
      }
    } catch {
      break;
    }
    break;
  }
  return msg.trim();
}

/** Turn any thrown error into a clean, one-line, user-facing message: unwrap nested
 *  JSON, strip URLs, and map known backend conditions to friendly copy. Use this in
 *  every catch that surfaces an error to the UI. */
export function cleanError(e: unknown): string {
  let msg =
    e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  msg = unwrapErrorMessage(msg);
  // Strip any leftover URLs (e.g. `https://node/api/v1/...`).
  msg = msg.replace(/https?:\/\/\S+/g, "").trim();
  // Strip a trailing/leading path fragment like `/api/v1/wallets/.../deposit:`.
  msg = msg.replace(/(^|\s)\/[\w./-]+:\s*/g, " ").trim();

  const lower = msg.toLowerCase();
  if (lower.includes("insufficient balance") || lower.includes("insufficient funds")) {
    return "Insufficient balance — fund the wallet to continue.";
  }
  if (msg.includes("CONTENTION") || lower.includes("contention")) {
    return "Busy — another transaction touched this; retry.";
  }
  if (msg.includes("INSUFFICIENT_FUNDS")) {
    return "Not enough shielded balance for this amount.";
  }
  // "no invite" and "not whitelisted" are already human — keep as-is.
  if (!msg) return "Something went wrong.";
  return msg;
}

export class RingClient {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok && res.status !== 202) {
      const raw =
        typeof json.error === "string" ? json.error : json.error != null
          ? JSON.stringify(json.error)
          : `HTTP ${res.status}`;
      throw new RingApiError(unwrapErrorMessage(raw), res.status);
    }
    return json as T;
  }

  // auth
  exchange(privyToken: string) {
    return this.req<{ biscuit: string; user: Me["user"] }>("POST", "/auth/exchange", { privyToken });
  }
  me() {
    return this.req<Me>("GET", "/v1/me");
  }

  // portfolio & contracts
  portfolio() {
    return this.req<Portfolio>("GET", "/v1/portfolio");
  }
  contracts(filter?: { template?: number; party?: string }) {
    const q = new URLSearchParams();
    if (filter?.template !== undefined) q.set("template", String(filter.template));
    if (filter?.party) q.set("party", filter.party);
    const qs = q.toString();
    return this.req<{ contracts: ContractRow[] }>("GET", `/v1/contracts${qs ? `?${qs}` : ""}`);
  }
  contract(cid: string) {
    return this.req<ContractRow>("GET", `/v1/contracts/${cid}`);
  }

  // flows
  shield(party: string, amountMicro: bigint) {
    return this.req<{ txid: string; cid: string }>("POST", "/v1/shield", {
      party,
      amountMicro: amountMicro.toString(),
    });
  }
  transfer(fromParty: string, toPartyOrEns: string, amountMicro: bigint) {
    return this.req<TransferResult>("POST", "/v1/transfers", {
      fromParty,
      toPartyOrEns,
      amountMicro: amountMicro.toString(),
    });
  }
  unshield(party: string, amountMicro: bigint, recipient: string) {
    return this.req<{ txid: string }>("POST", "/v1/unshield", {
      party,
      amountMicro: amountMicro.toString(),
      recipient,
    });
  }

  // approvals (four-eyes)
  approvals() {
    return this.req<{ approvals: Approval[] }>("GET", "/v1/approvals");
  }
  decide(approvalId: number, approve: boolean, reason?: string) {
    return this.req<TransferResult & { status: string }>("POST", `/v1/approvals/${approvalId}/decide`, {
      approve,
      reason,
    });
  }

  // admin
  inviteUser(email: string, role: string, limitMicro?: bigint) {
    return this.req<{ user: unknown }>("POST", "/v1/users/invite", {
      email,
      role,
      limitMicro: limitMicro?.toString(),
    });
  }
  users() {
    return this.req<{ users: unknown[] }>("GET", "/v1/users");
  }
  whitelist() {
    return this.req<{ whitelist: unknown[] }>("GET", "/v1/whitelist");
  }
  addWhitelist(ensName: string) {
    return this.req<{ ensName: string; encPubkey: string; partyRoot: string }>(
      "POST",
      "/v1/whitelist",
      { ensName },
    );
  }
  serviceToken(maxNotionalMicro?: bigint, ttlSeconds?: number, role?: string) {
    return this.req<{ biscuit: string }>("POST", "/v1/service-tokens", {
      maxNotionalMicro: maxNotionalMicro?.toString(),
      ttlSeconds,
      role,
    });
  }
  auditExport() {
    return this.req<{ org: string; notes: unknown[]; auditLog: unknown[] }>("GET", "/v1/audit/export");
  }
  resync() {
    return this.req<{ ok: boolean; treeSize: number }>("POST", "/v1/resync");
  }

  /** Subscribe to the authenticated event stream. Returns an abort function. */
  events(onEvent: (e: RingEvent) => void): () => void {
    const ctrl = new AbortController();
    void (async () => {
      const res = await fetch(`${this.baseUrl}/v1/events`, {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        signal: ctrl.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (const chunk of buf.split("\n\n").slice(0, -1)) {
          const data = chunk.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
          if (data) {
            try {
              onEvent(JSON.parse(data));
            } catch {}
          }
        }
        buf = buf.split("\n\n").slice(-1)[0];
      }
    })().catch(() => {});
    return () => ctrl.abort();
  }
}
