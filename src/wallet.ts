import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

/**
 * Resolves the signing key for live trading.
 * Priority: PRIVATE_KEY env > persisted generated wallet in data/ > generate on demand.
 * The generated wallet only ever lives in data/ (gitignored).
 */
export function resolveWallet(): { privateKey: `0x${string}`; address: string; generated: boolean } | null {
  if (config.privateKey) {
    const account = privateKeyToAccount(config.privateKey as `0x${string}`);
    return { privateKey: config.privateKey as `0x${string}`, address: account.address, generated: false };
  }
  const dir = join(process.cwd(), config.dataDir);
  const file = join(dir, "wallet.json");
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    const account = privateKeyToAccount(saved.privateKey);
    return { privateKey: saved.privateKey, address: account.address, generated: true };
  }
  const privateKey = `0x${generatePrivateKey().slice(2)}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  writeFileSync(file, JSON.stringify({ privateKey, address: account.address }, null, 2), { mode: 0o600 });
  return { privateKey, address: account.address, generated: true };
}
