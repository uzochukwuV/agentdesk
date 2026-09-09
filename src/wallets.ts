import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

export interface WalletInfo {
  agentId: string;
  privateKey: `0x${string}`;
  address: string;
}

interface WalletFile {
  wallets: { agentId: string; privateKey: string; address: string }[];
}

/**
 * Resolves the signer for each agent desk.
 * Priority per agent: AGENT_<ID>_PRIVATE_KEY env > persisted wallets file in DATA_DIR > generated on demand.
 * PRIVATE_KEY (legacy single-wallet env) is used for all agents when present — useful for dev with one funded key.
 * Wallets are only persisted under DATA_DIR (gitignored).
 */
export function resolveWallets(agentIds: string[]): Map<string, WalletInfo> {
  const out = new Map<string, WalletInfo>();
  const legacy = (process.env.PRIVATE_KEY ?? "").trim();
  const dir = join(process.cwd(), config.dataDir);
  const file = join(dir, config.agentWalletFile);
  mkdirSync(dir, { recursive: true });
  let saved: WalletFile = { wallets: [] };
  if (existsSync(file)) {
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`[wallets] failed to parse ${config.agentWalletFile}, regenerating`, e);
    }
  }
  let changed = false;
  for (const agentId of agentIds) {
    const envVal = (process.env[`AGENT_${agentId.toUpperCase()}_PRIVATE_KEY`] ?? "").trim() || legacy;
    if (envVal.startsWith("0x")) {
      const account = privateKeyToAccount(envVal as `0x${string}`);
      out.set(agentId, { agentId, privateKey: envVal as `0x${string}`, address: account.address });
      continue;
    }
    let w = saved.wallets.find((x) => x.agentId === agentId);
    if (!w) {
      const privateKey = `0x${generatePrivateKey().slice(2)}` as `0x${string}`;
      const a = privateKeyToAccount(privateKey);
      w = { agentId, privateKey, address: a.address };
      saved.wallets.push(w);
      changed = true;
    }
    out.set(agentId, { agentId: w.agentId, privateKey: w.privateKey as `0x${string}`, address: w.address });
  }
  if (changed) writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  return out;
}
