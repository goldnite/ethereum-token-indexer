import { Types } from 'npm:mongoose';

export interface IChain {
  chainId: number;
  blockNumber: string;
  currency: string;
  wrappedNativeCurrencies: string[];
}

export interface IBalance {
  token: Types.ObjectId,
  amount: string,
  tokenId: string
}

export interface IAddress {
  hash: string,
  chain: Types.ObjectId,
  balances: object[]
}

export interface IToken {
  chain: Types.ObjectId,
  type: 'ERC20' | 'ERC721' | 'ERC1155',
  address: Types.ObjectId,
  holders: string,
  name: string,
  symbol: string,
  totalSupply: string
}
