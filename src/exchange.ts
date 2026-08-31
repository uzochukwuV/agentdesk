import {
  SomniaMarkets,
  SOMNIA_TESTNET_ADDRESSES,
  SOMNIA_MAINNET_ADDRESSES,
  SOMNIA_TESTNET_PRICE_FEED,
  isBinaryMarket,
} from "@somnia-chain/markets-sdk";
import { somniaMainnet, somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, type Address } from "viem";
import { config } from "./config.js";
import type { BookYes } from "./store.js";

export interface WindowMarket {
  marketId: string;
  symbol: string;
  yesSymbol: string;
  asset: string;
  intervalSec: number;
  expiry: number;
  windowStart: number;
  status: number;
  secondsLeft: number;
  pool: `0x${string}`;
  marketAddress: `0x${string}`;
  outcomeToken: `0x${string}`;
  yesId: bigint;
  noId: bigint;
}

export class Exchange {
  exchange: SomniaMarkets;
  private collateralDecimals: number;
  // loose type: the SDK's chain typings disagree with viem's PublicClient generics
  private publicClient: any;

  constructor(privateKey?: `0x${string}`) {
    const isMain = config.network === "mainnet";
    const chain = (isMain ? somniaMainnet : somniaShannon) as any;
    const addresses = isMain ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES;
    this.exchange = new SomniaMarkets({
      indexerUrl: config.indexerUrl,
      chain,
      wsRpcUrl: config.wsRpcUrl,
      addresses,
      priceFeed: isMain ? undefined : SOMNIA_TESTNET_PRICE_FEED,
      privateKey: privateKey || undefined,
      // SDK default (60 gwei × 10M gas = 0.6 STT ceiling) exceeds a faucet-funded desk's
      // balance; ~2× the observed ~6 gwei base fee still includes instantly on BFT.
      fees: { maxFeePerGas: 12_000_000_000n, maxPriorityFeePerGas: 0n },
    } as any);
    this.collateralDecimals = isMain ? 18 : 6;
    const rpcUrl = config.httpRpcUrl ?? (chain.rpcUrls?.default?.http?.[0] as string | undefined);
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  }

  get walletAddress(): string | undefined {
    return this.exchange.walletAddress;
  }

  get collateralToken(): `0x${string}` | undefined {
    const a = config.network === "mainnet" ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES;
    return (a?.collateral ?? a?.testUsdc) as `0x${string}` | undefined;
  }

  /** Collateral balance in human units (for faucet decisions). */
  async getCollateralBalanceHuman(account: string): Promise<number> {
    const token = this.collateralToken;
    if (!token) return 0;
    const [bal] = await this.exchange.client.getBalances([{ token }], account as `0x${string}`);
    return Number(bal) / 10 ** this.collateralDecimals;
  }

  /** Native gas-token balance in human units (STT on testnet, SOMI on mainnet). */
  async getNativeBalanceHuman(account: string): Promise<number> {
    const bal = await this.publicClient.getBalance({ address: account as `0x${string}` });
    return Number(bal) / 1e18;
  }

  /** All live binary windows for the configured cadence, gated on-chain, with headroom. */
  async findWindows(assets: string[], intervalSec: number): Promise<(WindowMarket | null)[]> {
    const markets = Object.values(await this.exchange.loadMarkets(true));
    const now = Date.now() / 1000;
    const out: (WindowMarket | null)[] = [];
    for (const asset of assets) {
      let best: WindowMarket | null = null;
      for (const m of markets) {
        if (!m.active || !isBinaryMarket(m.info)) continue;
        const info = m.info as any;
        if (info.asset !== asset || Number(info.intervalSec) !== intervalSec) continue;
        try {
          const oc = await this.exchange.client.getMarketOnchain(info.marketId as `0x${string}`);
          if (oc.status !== 1) continue; // Trading only
          const secondsLeft = Number(oc.expiry) - now;
          if (secondsLeft < config.minWindowHeadroomSec) continue;
          const w: WindowMarket = {
            marketId: info.marketId as string,
            symbol: m.symbol ?? String(info.asset),
            yesSymbol: (m as any).outcomes?.[0]?.symbol ?? `${m.symbol}#YES`,
            asset,
            intervalSec,
            expiry: Number(oc.expiry),
            windowStart: Number(oc.expiry) - intervalSec,
            status: oc.status,
            secondsLeft,
            pool: oc.pool,
            marketAddress: oc.marketAddress,
            outcomeToken: oc.outcomeToken,
            yesId: oc.yesId,
            noId: oc.noId,
          };
          if (!best || w.secondsLeft > best.secondsLeft) best = w;
        } catch {
          continue;
        }
      }
      out.push(best);
    }
    return out;
  }

  async getYesBook(symbol: string): Promise<BookYes> {
    try {
      const book = await this.exchange.fetchOrderBook(symbol, 5);
      const bid = book.bids[0]?.[0] ?? null;
      const ask = book.asks[0]?.[0] ?? null;
      return {
        bid,
        ask,
        mid: bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null,
      };
    } catch (e: any) {
      console.error(`[exchange] fetchOrderBook(${symbol}) failed:`, e?.shortMessage ?? e?.message ?? String(e));
      return { bid: null, ask: null, mid: null };
    }
  }

  /** Build browser-wallet transactions without ever receiving a user private key. */
  async buildUserOrder(
    win: WindowMarket,
    owner: Address,
    side: "YES" | "NO",
    contractsHuman: number,
    limitYesPrice: number,
  ) {
    const scale = BigInt(10 ** this.collateralDecimals);
    const tick = isMainTick(this.collateralDecimals);
    const ticksToPrice = (p: number) => BigInt(Math.round(p * Number(scale / tick))) * tick;
    const lotsToQty = (q: number) => BigInt(Math.floor(q * Number(scale / tick) + 1e-9)) * tick;
    const priceRaw = ticksToPrice(limitYesPrice);
    const qtyRaw = lotsToQty(contractsHuman);
    if (qtyRaw === 0n || priceRaw === 0n) throw new Error("order rounds to zero on the lot grid");

    const trader = this.exchange.client.createTrader({ account: owner });
    const unsigned = await trader.buildPlaceOrder({
      pool: win.pool,
      side: side === "YES" ? "BUY_YES" : "BUY_NO",
      price: priceRaw,
      quantity: qtyRaw,
      orderType: 2, // IOC: fill now or cancel the remainder.
      expireTimestampNs: BigInt(Math.floor(Math.min(Date.now() / 1000 + 240, win.expiry))) * 1_000_000_000n,
      outcomeToken: win.outcomeToken,
      yesId: win.yesId,
      noId: win.noId,
      collateral: this.collateralToken,
    });
    const serializeCall = (call: any) =>
      call
        ? {
            to: call.to,
            data: call.data,
            value: `0x${call.value.toString(16)}`,
            description: call.description,
          }
        : null;
    return {
      order: serializeCall(unsigned.order),
      approval: serializeCall(unsigned.approval),
      side,
      contracts: contractsHuman,
      limitYesPrice,
      collateralDecimals: this.collateralDecimals,
      network: config.network,
      chainId: config.network === "mainnet" ? 5031 : 50312,
    };
  }

  getMarketOnchainSnapshot(marketId: string) {
    return this.exchange.client.getMarketOnchain(marketId as `0x${string}`);
  }

  /** Place a live taker (IOC) order on the raw trader tier with tick-snapped integer price/qty. */
  async placeLiveTrade(
    win: WindowMarket,
    side: "YES" | "NO",
    contractsHuman: number,
    limitYesPrice: number
  ): Promise<{ txHash: string; filledQty: number; avgYesPrice: number; spentCollateral: number }> {
    const scale = BigInt(10 ** this.collateralDecimals);
    // docs: testnet tick = 1e3 (0.001), mainnet tick = 1e15 (0.001)
    const tick = isMainTick(this.collateralDecimals);
    const ticksToPrice = (p: number) => BigInt(Math.round(p * Number(scale / tick))) * tick;
    const lotsToQty = (q: number) => BigInt(Math.floor(q * Number(scale / tick) + 1e-9)) * tick;

    const sideEnum = side === "YES" ? "BUY_YES" : "BUY_NO";
    const priceRaw = ticksToPrice(limitYesPrice);
    const qtyRaw = lotsToQty(contractsHuman);
    if (qtyRaw === 0n || priceRaw === 0n) throw new Error("order rounds to zero on the lot grid");

    const res = await this.exchange.trader.placeOrder({
      pool: win.pool,
      side: sideEnum,
      price: priceRaw,
      quantity: qtyRaw,
      orderType: 2, // IOC
      expireTimestampNs: BigInt(Math.floor(Math.min(Date.now() / 1000 + 240, win.expiry))) * 1_000_000_000n,
      outcomeToken: win.outcomeToken,
      yesId: win.yesId,
      noId: win.noId,
    });
    const receipt = res.receipt;
    if (!receipt || receipt.status !== "success") {
      throw new Error(`order reverted on-chain (${receipt?.transactionHash ?? "no receipt"})`);
    }
    const dec = this.collateralDecimals;
    let qty = 0;
    let cost = 0;
    let maxYesPrice = 0;
    for (const f of res.fills) {
      const q = Number(f.quantityFilled) / 10 ** dec;
      const yesPrice = Number(f.fillPrice) / 10 ** dec; // YES-terms price
      qty += q;
      // price the bought side: buying NO at YES-price p pays (1 - p)
      cost += q * (side === "YES" ? yesPrice : 1 - yesPrice);
      maxYesPrice = Math.max(maxYesPrice, yesPrice);
    }
    const avgYesPrice =
      side === "YES" ? (qty > 0 ? cost / qty : Number(priceRaw) / 10 ** dec) : (qty > 0 ? cost / qty : 1 - Number(priceRaw) / 10 ** dec);
    if (qty <= 0) throw new Error("IOC order filled nothing (book moved)");
    return { txHash: receipt.transactionHash, filledQty: qty, avgYesPrice, spentCollateral: cost };
  }

  async faucet(): Promise<string> {
    // SDK default gas is too low for this contract — pass explicit amount (10k tUSDC) + gas.
    const res = await this.exchange.trader.faucet({ amount: 10000n * 10n ** 6n, gas: 300000n } as any);
    if (res.receipt?.status !== "success") throw new Error("faucet reverted");
    return res.receipt?.transactionHash ?? "unknown";
  }

  async claimable(account: string) {
    return this.exchange.client.getClaimable(account);
  }

  async redeem(claim: { marketId: string; outcomeIdx: 0 | 1; amount: bigint }): Promise<string> {
    const res = await this.exchange.trader.redeem({
      marketId: claim.marketId as `0x${string}`,
      outcomeIdx: claim.outcomeIdx,
      amount: claim.amount,
    });
    return res.receipt?.transactionHash ?? "unknown";
  }

  decimals(): number {
    return this.collateralDecimals;
  }
}

function isMainTick(decimals: number): bigint {
  return decimals === 18 ? 1_000_000_000_000_000n : 1_000n;
}
