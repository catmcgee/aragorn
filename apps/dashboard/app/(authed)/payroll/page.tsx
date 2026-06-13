"use client";

// Payroll admin — manage ENS-subname employees and run a payroll batch that
// mints private salary entitlements (claimed later via My Pay). The payroll
// endpoints are not in @aragorn/sdk yet, so this page uses raw authed fetch.

import { useEffect, useState } from "react";
import { useRing, getStoredToken } from "@/lib/ring";
import { fmtMicro, usdcToMicro } from "@/lib/format";
import { HashChip } from "@/components/chips";

interface Employee {
  id: number;
  subname_label: string;
  email: string | null;
  has_claim: boolean;
}

interface PayrollItem {
  id: number;
  employee_id: number;
  amount_micro: string;
  status: "claimable" | "claimed" | "pending";
  entitlement_cid: string | null;
  subname_label: string;
}

const ITEM_PILL: Record<PayrollItem["status"], string> = {
  claimable: "pill pill-held",
  claimed: "pill pill-pos",
  pending: "pill pill-neutral",
};

const MAX_ROWS = 3;
const DEFAULT_ENS = "ubs.aragornrings.eth";

async function authedFetch(
  ringUrl: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const token = getStoredToken();
  const res = await fetch(`${ringUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && res.status !== 202) {
    throw new Error((json.error as string) ?? `HTTP ${res.status}`);
  }
  return json;
}

export default function PayrollPage() {
  const { me, ringUrl, tick } = useRing();
  const ensSuffix = me.ens ?? DEFAULT_ENS;
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [items, setItems] = useState<PayrollItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // add-employee form
  const [newLabel, setNewLabel] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  // run-payroll form
  const [payerParty, setPayerParty] = useState("treasury");
  const [rows, setRows] = useState<{ employeeId: string; amount: string }[]>([
    { employeeId: "", amount: "" },
  ]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch(ringUrl, "/v1/employees")
      .then((r) => live && setEmployees((r.employees as Employee[]) ?? []))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    authedFetch(ringUrl, "/v1/payroll/items")
      .then((r) => live && setItems((r.items as PayrollItem[]) ?? []))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ringUrl, tick, refresh]);

  async function addEmployee(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      await authedFetch(ringUrl, "/v1/employees", {
        subnameLabel: newLabel.trim(),
        ...(newEmail.trim() ? { email: newEmail.trim() } : {}),
      });
      setNewLabel("");
      setNewEmail("");
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  function setRow(i: number, patch: Partial<{ employeeId: string; amount: string }>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function runPayroll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRunResult(null);
    setRunning(true);
    try {
      const payments = rows
        .filter((r) => r.employeeId && r.amount.trim())
        .map((r) => ({
          employeeId: Number(r.employeeId),
          amountMicro: usdcToMicro(r.amount).toString(),
        }));
      if (payments.length === 0) throw new Error("Add at least one payment row");
      const res = await authedFetch(ringUrl, "/v1/payroll/run", {
        payerParty: payerParty.trim(),
        payments,
      });
      const txids = Array.isArray(res.txids) ? res.txids : [res.txids];
      setRunResult(`Ran — tx ${txids.join(", ")}`);
      setRows([{ employeeId: "", amount: "" }]);
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="px-8 py-6 max-w-[1180px] space-y-6">
      <div>
        <div className="page-eyebrow">Payroll</div>
        <h1 className="page-title">Payroll</h1>
      </div>
      {error && <p className="err">{error}</p>}

      <section className="card">
        <h2 className="section-title">Employees</h2>
        {!employees ? (
          <p className="text-sm text-ink-5">Loading…</p>
        ) : employees.length === 0 ? (
          <p className="text-sm text-ink-5">No employees.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">Subname</th>
                <th className="th">Email</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                >
                  <td className="td tabular-nums">{emp.id}</td>
                  <td className="td font-mono text-xs">
                    {emp.subname_label}.{ensSuffix}
                  </td>
                  <td className="td">{emp.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form className="mt-4 flex items-end gap-2" onSubmit={addEmployee}>
          <div>
            <label className="label" htmlFor="emp-label">
              Subname label
            </label>
            <input
              id="emp-label"
              className="input w-40"
              placeholder="alice"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="emp-email">
              Email (optional)
            </label>
            <input
              id="emp-email"
              className="input w-56"
              placeholder="alice@ubs.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn"
            disabled={adding || !newLabel.trim()}
          >
            {adding ? "Adding…" : "Add employee"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 className="section-title">Run payroll</h2>
        <form className="space-y-3" onSubmit={runPayroll}>
          {rows.map((row, i) => (
            <div key={i} className="flex items-end gap-2">
              <div>
                <label className="label" htmlFor={`pay-emp-${i}`}>
                  Employee
                </label>
                <select
                  id={`pay-emp-${i}`}
                  className="input w-64"
                  value={row.employeeId}
                  onChange={(e) => setRow(i, { employeeId: e.target.value })}
                >
                  <option value="">Select…</option>
                  {(employees ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.subname_label}.{ensSuffix}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={`pay-amt-${i}`}>
                  Amount (USDC)
                </label>
                <input
                  id={`pay-amt-${i}`}
                  className="input w-36"
                  placeholder="5000.00"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                />
              </div>
            </div>
          ))}

          <div className="flex items-end gap-2">
            <button
              type="button"
              className="btn"
              disabled={rows.length >= MAX_ROWS}
              onClick={() =>
                setRows((rs) => [...rs, { employeeId: "", amount: "" }])
              }
            >
              Add row
            </button>
            <div>
              <label className="label" htmlFor="payer">
                Payer party
              </label>
              <input
                id="payer"
                className="input w-40"
                value={payerParty}
                onChange={(e) => setPayerParty(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={running || !payerParty.trim()}
            >
              {running ? "Running…" : "Run payroll"}
            </button>
          </div>

          {runResult && (
            <p className="font-mono text-sm text-pos">{runResult}</p>
          )}
        </form>

        <h3 className="section-title mt-6">Payroll items</h3>
        {!items ? (
          <p className="text-sm text-ink-5">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-5">No payroll items.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th">Subname</th>
                <th className="th">Amount</th>
                <th className="th">Status</th>
                <th className="th">Entitlement</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                >
                  <td className="td font-mono text-xs">
                    {it.subname_label}.{ensSuffix}
                  </td>
                  <td className="td tabular-nums">{fmtMicro(it.amount_micro)}</td>
                  <td className="td">
                    <span className={ITEM_PILL[it.status] ?? "pill pill-neutral"}>
                      {it.status}
                    </span>
                  </td>
                  <td className="td">
                    <HashChip value={it.entitlement_cid} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
