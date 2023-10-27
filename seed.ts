
import { ChainModel, AddressModel, TokenModel } from './db.ts';
import { chains } from "./chains.ts";

const chainIds = await ChainModel.insertMany(
  Object.keys(chains).map((key) => ({
    chainId: Number(chains[key].id),
    blockNumber: '0',
    currency: chains[key].nativeCurrency.symbol,
    wrappedNativeCurrencies: chains[key].wrappedNativeCurrencies
  }))
);
Deno.exit(0);