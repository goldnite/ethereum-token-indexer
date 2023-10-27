export enum TokenType {
  ERC20,
  ERC721,
  ERC1155
}

export interface ChainSchema {
  chainId: number;
  blockNumber: string;
  currency: string;
}

export interface AddressSchema {
  hash: string;
  chain: ChainSchema;
  balances: Balance[]
}

export interface Balance {
  token: TokenSchema;
  tokenType: TokenType;
  amount: string;
  tokenId: string;
}

export interface TokenSchema {
  type: TokenType;
  address: AddressSchema;
  decimals: number;
  holders: string;
  name: string;
  symbol: string;
  totalSupply: string;
}