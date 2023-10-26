import {
  Bson,
  MongoClient,
  ObjectId,
} from "x/mongo/mod.ts";
import "std/dotenv/load.ts";

const client = new MongoClient();
const DB_URL = Deno.env.get("DATABASE_URL");
if (DB_URL) await client.connect(DB_URL);
else throw new Error("DATABASE_URL not found.");
const db = client.database();


export enum TokenType {
  ERC20,
  ERC721,
  ERC1155
}

export interface Chain {
  _id: ObjectId;
  chainId: number;
  blockNumber: string;
  currency: string;
}

export interface Address {
  _id: ObjectId;
  hash: string;
  chain: Chain;
  balances: Balance[]
}

export interface Balance {
  token: Token;
  tokenType: TokenType;
  amount: string;
  tokenId: string;
}

export interface Token {
  _id: ObjectId;
  type: TokenType;
  address: Address;
  decimals: number;
  holders: string;
  name: string;
  symbol: string;
  totalSupply: string;
}

export const chain = db.collection<Chain>("chains");
export const address = db.collection<Address>("addresses");
export const token = db.collection<Token>("tokens");