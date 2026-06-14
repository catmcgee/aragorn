"use client";

import { useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { HashChip } from "@/components/chips";

const MAX_LINES = 200;

// Audit log entries are loosely typed; pull a commitment/txid and a label
// out of whatever shape the ring returns.
type LogRow = Record<string, unknown>;
type Picked = { key: string; value: string };
const pick = (r: LogRow, ...keys: string[]): Picked | undefined => {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v) return { key: k, value: v };
    if (typeof v === "number") return { key: k, value: String(v) };
  }
  return undefined;
};
const pickValue = (r: LogRow, ...keys: string[]): string | undefined => pick(r, ...keys)?.value;

export default function AuditPage() {
  const { client, me, openPublic } = useRing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  if (!me.capabilities.includes("audit")) {
    return (
      <p className="px-8 py-6 text-sm text-ink-5">
        Not authorized for audit export.
      </p>
    );
  }

  async function exportPackage() {
    setBusy(true);
    setError(null);
    try {
      const pkg = await client.auditExport();
      setLog(Array.isArray(pkg.auditLog) ? (pkg.auditLog as LogRow[]) : []);
      const json = JSON.stringify(pkg, null, 2);
      const lines = json.split("\n");
      setTruncated(lines.length > MAX_LINES);
      setPreview(lines.slice(0, MAX_LINES).join("\n"));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(URL.createObjectURL(new Blob([json], { type: "application/json" })));
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-6 max-w-[1180px] space-y-6">
      <div>
        <div className="page-eyebrow">Audit</div>
        <h1 className="page-title">Audit</h1>
        <p className="page-caption">
          Export the decrypted record — every commitment is anchored on public
          Ethereum.
        </p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={exportPackage}>
            {busy ? "Exporting…" : "Export audit package"}
          </button>
          {downloadUrl && (
            <a className="btn" href={downloadUrl} download="audit-export.json">
              Download JSON
            </a>
          )}
        </div>
        {error && <p className="err">{error}</p>}
      </div>

      {/* Commitment log — each row opens what the world sees onchain. */}
      {log && log.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="h-[3px] w-4 rounded-sm bg-gold shrink-0" />
            <span className="text-[11px] tracking-[0.14em] uppercase text-ink-4">
              Commitments
            </span>
            <span className="text-[10.5px] text-ink-6">{log.length} entries</span>
            <div className="flex-1 h-px bg-line-soft" />
          </div>
          <div className="card-flat overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Event</th>
                  <th className="th">Commitment</th>
                  <th className="th">When</th>
                  <th className="th-num">Chain</th>
                </tr>
              </thead>
              <tbody>
                {log.map((row, i) => {
                  const hash = pick(row, "txid", "tx", "commitment", "cid");
                  const isTx = hash?.key === "txid" || hash?.key === "tx";
                  const kind =
                    pickValue(row, "kind", "type", "event", "action") ?? "—";
                  const ts = pickValue(row, "ts", "at", "created_at", "timestamp");
                  return (
                    <tr
                      key={i}
                      className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                    >
                      <td className="td">{kind}</td>
                      <td className="td">
                        {hash ? <HashChip value={hash.value} kind={isTx ? "tx" : "cid"} /> : "—"}
                      </td>
                      <td className="td text-xs text-ink-4">
                        {ts
                          ? Number.isFinite(Number(ts))
                            ? new Date(Number(ts) * 1000).toLocaleString()
                            : ts
                          : "—"}
                      </td>
                      <td className="td-num">
                        {isTx ? (
                          <button
                            className="public-pill"
                            onClick={() => openPublic(hash.value)}
                          >
                            ⊙ Public
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview !== null && (
        <div className="card">
          {truncated && (
            <p className="mb-2 text-xs text-ink-5">
              Showing first {MAX_LINES} lines — use the download link for the full
              package.
            </p>
          )}
          <pre className="max-h-[32rem] overflow-auto rounded-md border border-line bg-ground p-3 font-mono text-xs text-ink-3">
            {preview}
            {truncated ? "\n…" : ""}
          </pre>
        </div>
      )}
    </div>
  );
}
