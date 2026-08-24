// Mint TestUSDC (faucet) to every desk wallet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const { wallets } = JSON.parse(readFileSync(join(process.cwd(), "data/agentWallets.json"), "utf8"));
const rpc = "https://api.infra.testnet.somnia.network";
const pub = createPublicClient({ chain: somniaShannon as any, transport: http(rpc) });
const token = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
const abi = parseAbi(["function faucet(uint256 amount)", "function balanceOf(address) view returns (uint256)"]);
const amount = 10000n * 10n ** 6n; // 10,000 tUSDC

for (const w of wallets) {
  const account = privateKeyToAccount(w.privateKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: somniaShannon as any, transport: http(rpc) });
  try {
    const hash = await wallet.writeContract({ address: token, abi, functionName: "faucet", args: [amount] } as any);
    await pub.waitForTransactionReceipt({ hash });
    const bal = await pub.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address] } as any);
    console.log(`${w.agentId.padEnd(12)} minted; balance ${formatUnits(bal as bigint, 6)} tUSDC  (${hash})`);
  } catch (e: any) {
    console.log(`${w.agentId.padEnd(12)} faucet failed: ${(e?.shortMessage ?? e?.message ?? String(e)).slice(0, 160)}`);
  }
}
