
import { ChainModel } from './db.ts';
import { chains, wrappedNativeCurrencies } from "./chains.ts";

await ChainModel.insertMany(
  Object.keys(chains).map((key) => ({
    chainId: Number(chains[key].id),
    blockNumber: '0',
    currency: chains[key].nativeCurrency.symbol,
    wrappedNativeCurrencies: wrappedNativeCurrencies[key]
  }))
);
Deno.exit(0);