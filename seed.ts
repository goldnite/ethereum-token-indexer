import { ChainModel, AddressModel } from './db.ts';
import { chains, wrappedNativeCurrencies } from "./chains.ts";
import { zeroAddress } from 'npm:viem';

const chainDocuments = await ChainModel.insertMany(
  Object.keys(chains).map((key) => ({
    chainId: Number(chains[key].id),
    blockNumber: '0',
    currency: chains[key].nativeCurrency.symbol,
    wrappedNativeCurrencies: wrappedNativeCurrencies[key]
  }))
);
await AddressModel.insertMany(chainDocuments.map((chain) => ({
  chain,
  hash: zeroAddress as string,
  balances: []
})));
Deno.exit(0);