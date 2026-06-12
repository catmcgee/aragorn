"use client";

import { useEffect, useState } from "react";
import { useRing } from "@/lib/ring";

const MAX_LINES = 200;

export default function AuditPage() {
  const { client, me } = useRing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  if (!me.capabilities.includes("audit")) {
    return <p className="text-sm text-slate-500">Not authorized for audit export.</p>;
  }

  async function exportPackage() {
    setBusy(true);
    setError(null);
    try {
      const pkg = await client.auditExport();
      const json = JSON.stringify(pkg, null, 2);
      const lines = json.split("\n");
      setTruncated(lines.length > MAX_LINES);
      setPreview(lines.slice(0, MAX_LINES).join("\n"));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(URL.createObjectURL(new Blob([json], { type: "application/json" })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Audit</h1>

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
        {preview !== null && (
          <div>
            {truncated && (
              <p className="mb-2 text-xs text-slate-500">
                Showing first {MAX_LINES} lines — use the download link for the full package.
              </p>
            )}
            <pre className="max-h-[32rem] overflow-auto rounded border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {preview}
              {truncated ? "\n…" : ""}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
