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

export interface ChainSchema {
  _id: ObjectId;
  chainId: number;
  blockNumber: string;
  currency: string;
}

export interface AddressSchema {
  _id: ObjectId;
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
  _id: ObjectId;
  type: TokenType;
  address: AddressSchema;
  decimals: number;
  holders: string;
  name: string;
  symbol: string;
  totalSupply: string;
}

export const chainModel = db.collection<ChainSchema>("chains");
export const addressModel = db.collection<AddressSchema>("addresses");
export const tokenModel = db.collection<TokenSchema>("tokens");