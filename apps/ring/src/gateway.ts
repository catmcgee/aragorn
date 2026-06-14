// CCIP-Read gateway (ERC-3668 + ENSIP-10, BUILD_SPEC §6.5): serves SIGNED resolution
// responses for employee subnames (e.g. cat.ubs.aragorn-rings.eth) from the employees table.
// The onchain OffchainResolver pins this gateway's signer pubkey, so even a hosted gateway
// cannot forge records. Employee labels are capabilities, not a directory (PLAN §11).
import { Hono } from "hono";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  namehash,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Sql } from "./db.ts";

const RESOLVER_SERVICE_ABI = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes sig)",
]);
const INNER_ABI = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);

/** DNS wire format → "cat.ubs.aragorn-rings.eth" */
export function dnsDecode(name: Uint8Array): string {
  const labels: string[] = [];
  let i = 0;
  while (i < name.length && name[i] !== 0) {
    const len = name[i];
    labels.push(new TextDecoder().decode(name.slice(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return labels.join(".");
}

export function buildGateway(sql: Sql, signerKey: `0x${string}`, ringEns: string | undefined): Hono {
  const signer = privateKeyToAccount(signerKey);
  const app = new Hono();

  app.get("/gateway/health", (c) => c.json({ signer: signer.address, serves: ringEns ?? null }));

  // EIP-3668: GET /gateway/{sender}/{callData}.json
  app.get("/gateway/:sender/:data", async (c) => {
    try {
      const sender = c.req.param("sender") as `0x${string}`;
      const callData = c.req.param("data").replace(/\.json$/, "") as `0x${string}`;

      const outer = decodeFunctionData({ abi: RESOLVER_SERVICE_ABI, data: callData });
      const [dnsName, innerData] = outer.args as [`0x${string}`, `0x${string}`];
      const fullName = dnsDecode(Buffer.from(dnsName.slice(2), "hex"));
      const inner = decodeFunctionData({ abi: INNER_ABI, data: innerData });

      // label.<ringEns> → employees.subname_label
      const label = fullName.split(".")[0];
      const [employee] = await sql`
        SELECT e.*, u.email FROM employees e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.subname_label = ${label}`;

      let result: `0x${string}`;
      if (inner.functionName === "addr") {
        result = encodeAbiParameters([{ type: "address" }], [zeroAddress]);
      } else {
        const key = inner.args[1] as string;
        let value = "";
        if (employee) {
          if (key === "description") value = `Employee @ ${ringEns ?? "aragorn ring"}`;
          else if (key === "email" && employee.email) value = employee.email;
          else if (key === "aragorn.employee") value = "true";
        }
        result = encodeAbiParameters([{ type: "string" }], [value]);
      }

      // SignatureVerifier.makeSignatureHash:
      // keccak256(0x1900 ‖ target ‖ expires ‖ keccak(request) ‖ keccak(result))
      const expires = BigInt(Math.floor(Date.now() / 1000) + 300);
      const hash = keccak256(
        encodePacked(
          ["bytes2", "address", "uint64", "bytes32", "bytes32"],
          ["0x1900", sender, expires, keccak256(callData), keccak256(result)],
        ),
      );
      const sig = await signer.sign({ hash });

      const data = encodeAbiParameters(
        [{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }],
        [result, expires, sig],
      );
      return c.json({ data });
    } catch (e: any) {
      return c.json({ message: e.message }, 400);
    }
  });

  return app;
}
