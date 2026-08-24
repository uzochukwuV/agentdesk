import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const { wallets } = JSON.parse(readFileSync(join(process.cwd(), "data/agentWallets.json"), "utf8"));
const w = wallets.find((x: any) => x.agentId === (process.argv[2] ?? "meanrev"));
const account = privateKeyToAccount(w.privateKey as `0x${string}`);
const rpc = "https://api.infra.testnet.somnia.network";
const pub = createPublicClient({ chain: somniaShannon as any, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: somniaShannon as any, transport: http(rpc) });

const token = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
const abi = parseAbi([
  "function faucet(uint256 amount)",
  "function faucet()",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
]);

console.log("decimals:", await pub.readContract({ address: token, abi, functionName: "decimals" } as any).catch(() => "n/a"));
console.log("name:", await pub.readContract({ address: token, abi, functionName: "name" } as any).catch(() => "n/a"));

for (const [fn, args] of [["faucet", [10000n * 10n ** 6n]], ["faucet", []]] as const) {
  try {
    // simulate first
    const sim = await pub.simulateContract({ account: account.address, address: token, abi, functionName: fn, args: args as any });
    console.log(fn, "simulate OK");
    const hash = await wallet.writeContract({ address: token, abi, functionName: fn, args: args as any } as any);
    console.log(fn, "tx:", hash);
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(fn, "status:", r.status);
  } catch (e: any) {
    console.log(fn, "failed:", (e?.shortMessage ?? e?.message ?? String(e)).slice(0, 200));
  }
}
