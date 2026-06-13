"use client";

import { useEffect, useState } from "react";
import { useRing } from "@/lib/ring";
import { fmtMicro, shortHex, usdcToMicro } from "@/lib/format";
import RoadmapBox from "@/components/RoadmapBox";

const ROLES = ["admin", "trader", "approver", "viewer", "auditor", "employee"];

// API rows are loosely typed in the SDK; read both snake_case and camelCase.
type Row = Record<string, unknown>;
const str = (r: Row, ...keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.join(", ");
  }
  return "—";
};

export default function AdminPage() {
  return (
    <div className="px-8 py-6 max-w-3xl space-y-6">
      <div>
        <div className="page-eyebrow">Admin</div>
        <h1 className="page-title">Admin</h1>
      </div>
      <UsersSection />
      <WhitelistSection />
      <OmsSection />

      <div className="grid grid-cols-2 gap-4">
        <RoadmapBox title="FROST quorum">
          Threshold signing for the Ring&apos;s settlement key — t-of-n across
          operator HSMs.
        </RoadmapBox>
        <RoadmapBox title="HSM">
          Hardware-backed custody of note-encryption and viewing keys.
        </RoadmapBox>
        <RoadmapBox title="Safe link">
          Bind the Ring&apos;s funding EOA to a Safe with policy guards.
        </RoadmapBox>
        <RoadmapBox title="Key rotation">
          Rotate org keys without breaking historical viewing-key derivation.
        </RoadmapBox>
      </div>
    </div>
  );
}

function UsersSection() {
  const { client, tick } = useRing();
  const [users, setUsers] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("trader");
  const [actAs, setActAs] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .users()
      .then((r) => live && setUsers(r.users as Row[]))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client, tick, refresh]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInvited(null);
    setBusy(true);
    try {
      const parties = actAs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const limitMicro = limit.trim() ? usdcToMicro(limit) : undefined;
      await client.inviteUser(email.trim(), role, parties, limitMicro);
      setInvited(`Invited ${email.trim()}`);
      setEmail("");
      setActAs("");
      setLimit("");
      setRefresh((n) => n + 1);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <h2 className="section-title">Users</h2>
      {error && <p className="err">{error}</p>}
      {!users ? (
        <p className="text-sm text-ink-5">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-ink-5">No users.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th">Act as</th>
              <th className="th">Limit</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const limitRaw = (u.limitMicro ?? u.limit_micro) as string | null | undefined;
              return (
                <tr key={i} className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]">
                  <td className="td">{str(u, "email")}</td>
                  <td className="td">{str(u, "role")}</td>
                  <td className="td font-mono text-xs">{str(u, "actAs", "act_as")}</td>
                  <td className="td tabular-nums">
                    {limitRaw ? fmtMicro(String(limitRaw)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <form className="space-y-3 border-t border-line-soft pt-4" onSubmit={invite}>
        <h3 className="text-xs font-medium text-ink-4 uppercase">Invite user</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inv-email">Email</label>
            <input
              id="inv-email"
              type="email"
              required
              className="input w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="inv-role">Role</label>
            <select
              id="inv-role"
              className="input w-full"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-actas">Act as (comma-separated)</label>
            <input
              id="inv-actas"
              className="input w-full"
              placeholder="UBS::trading, UBS::treasury"
              value={actAs}
              onChange={(e) => setActAs(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="inv-limit">Limit (USDC, optional)</label>
            <input
              id="inv-limit"
              className="input w-full"
              placeholder="100000"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </button>
        {inviteError && <p className="err">{inviteError}</p>}
        {invited && <p className="text-sm text-pos">{invited}</p>}
      </form>
    </section>
  );
}

function WhitelistSection() {
  const { client, tick } = useRing();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [ensName, setEnsName] = useState("");
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ ensName: string; encPubkey: string; partyRoot: string } | null>(null);

  useEffect(() => {
    let live = true;
    client
      .whitelist()
      .then((r) => live && setRows(r.whitelist as Row[]))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client, tick, refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdded(null);
    setBusy(true);
    try {
      const res = await client.addWhitelist(ensName.trim());
      setAdded(res);
      setEnsName("");
      setRefresh((n) => n + 1);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <h2 className="section-title">Counterparty whitelist</h2>
      {error && <p className="err">{error}</p>}
      {!rows ? (
        <p className="text-sm text-ink-5">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-5">No whitelisted counterparties.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th">ENS name</th>
              <th className="th">Enc pubkey</th>
              <th className="th">Party root</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={i} className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]">
                <td className="td font-mono">{str(w, "ensName", "ens_name")}</td>
                <td className="td font-mono text-xs">
                  {shortHex(str(w, "encPubkey", "enc_pubkey"), 14)}
                </td>
                <td className="td font-mono text-xs">
                  {shortHex(str(w, "partyRoot", "party_root"), 14)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="flex items-end gap-2 border-t border-line-soft pt-4" onSubmit={add}>
        <div className="flex-1">
          <label className="label" htmlFor="wl-ens">ENS name</label>
          <input
            id="wl-ens"
            required
            className="input w-full"
            placeholder="drw.aragorn-rings.eth"
            value={ensName}
            onChange={(e) => setEnsName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
      {addError && <p className="err">{addError}</p>}
      {added && (
        <p className="font-mono text-xs text-pos">
          Added {added.ensName} — encpubkey {shortHex(added.encPubkey, 14)} · partyroot{" "}
          {shortHex(added.partyRoot, 14)}
        </p>
      )}
    </section>
  );
}

function OmsSection() {
  const { client } = useRing();
  const [actAs, setActAs] = useState("");
  const [maxNotional, setMaxNotional] = useState("");
  const [ttlHours, setTtlHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biscuit, setBiscuit] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBiscuit(null);
    setCopied(false);
    setBusy(true);
    try {
      const parties = actAs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const maxMicro = maxNotional.trim() ? usdcToMicro(maxNotional) : undefined;
      const hours = ttlHours.trim() ? Number(ttlHours) : undefined;
      const ttlSeconds =
        hours !== undefined && Number.isFinite(hours) ? Math.round(hours * 3600) : undefined;
      const res = await client.serviceToken(parties, maxMicro, ttlSeconds);
      setBiscuit(res.biscuit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!biscuit) return;
    await navigator.clipboard.writeText(biscuit);
    setCopied(true);
  }

  return (
    <section className="card space-y-4">
      <h2 className="section-title">Connect your OMS</h2>
      <p className="text-xs text-ink-5">
        Mint a scoped service token (biscuit) for machine access — paste it into your order
        management system.
      </p>
      <form className="space-y-3" onSubmit={mint}>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="oms-actas">Act as (comma-separated)</label>
            <input
              id="oms-actas"
              required
              className="input w-full"
              placeholder="UBS::trading"
              value={actAs}
              onChange={(e) => setActAs(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="oms-max">Max notional (USDC, optional)</label>
            <input
              id="oms-max"
              className="input w-full"
              placeholder="1000000"
              inputMode="decimal"
              value={maxNotional}
              onChange={(e) => setMaxNotional(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="oms-ttl">TTL (hours)</label>
            <input
              id="oms-ttl"
              className="input w-full"
              inputMode="numeric"
              value={ttlHours}
              onChange={(e) => setTtlHours(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Minting…" : "Mint service token"}
        </button>
        {error && <p className="err">{error}</p>}
      </form>
      {biscuit && (
        <div className="space-y-2">
          <textarea
            readOnly
            className="input h-28 w-full font-mono text-xs"
            value={biscuit}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="btn" onClick={copy}>
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
        </div>
      )}
    </section>
  );
}
