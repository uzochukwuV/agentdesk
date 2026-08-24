// Spread STT gas from one funded desk wallet to the others.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const file = join(process.cwd(), "data/agentWallets.json");
const { wallets } = JSON.parse(readFileSync(file, "utf8")) as { wallets: { agentId: string; privateKey: string; address: string }[] };

const fromId = process.argv[2] ?? "meanrev";
const source = wallets.find((w) => w.agentId === fromId);
if (!source) throw new Error(`no wallet for ${fromId}`);

const rpc = "https://api.infra.testnet.somnia.network";
const pub = createPublicClient({ chain: somniaShannon as any, transport: http(rpc) });
const account = privateKeyToAccount(source.privateKey as `0x${string}`);
const wallet = createWalletClient({ account, chain: somniaShannon as any, transport: http(rpc) });

const bal = await pub.getBalance({ address: account.address });
console.log(`${fromId} (${account.address}) balance: ${formatEther(bal)} STT`);

const recipients = wallets.filter((w) => w.agentId !== fromId);
const share = (bal * 9n / 10n) / BigInt(recipients.length); // keep 10% for the source
console.log(`sending ${formatEther(share)} STT to each of ${recipients.length} desks`);

for (const r of recipients) {
  const hash = await wallet.sendTransaction({ to: r.address as `0x${string}`, value: share } as any);
  console.log(`  ${r.agentId} <- ${hash}`);
  await pub.waitForTransactionReceipt({ hash });
}

for (const w of wallets) {
  const b = await pub.getBalance({ address: w.address as `0x${string}` });
  console.log(`${w.agentId.padEnd(12)} ${formatEther(b)} STT`);
}
