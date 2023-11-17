import mongoose, { Schema, InferSchemaType, HydratedDocument } from 'npm:mongoose';
import "std/dotenv/load.ts";

const DB_URL = Deno.env.get("DATABASE_URL");
if (DB_URL) await mongoose.connect(DB_URL);
else throw new Error("DATABASE_URL not found.");

export const ChainSchema = new Schema({
  chainId: { type: Number, unique: true, required: true },
  blockNumber: String,
  currency: String,
  wrappedNativeCurrencies: [String]
});

export const AddressSchema = new Schema({
  hash: String,
  chain: {
    type: Schema.Types.ObjectId,
    ref: 'Chain',
  },
  balances: [{
    token: {
      type: Schema.Types.ObjectId,
      ref: 'Token',
    },
    amount: String,
    tokenId: String
  }]
});

export const TokenSchema = new Schema({
  type: {
    type: String,
    enum: ['ERC20', 'ERC721', 'ERC1155']
  },
  address: {
    type: Schema.Types.ObjectId,
    ref: 'Address'
  },
  holders: String,
  name: String,
  symbol: String,
  totalSupply: String
});

export const TransferSchema = new Schema({
  token: {
    type: Schema.Types.ObjectId,
    ref: 'Token'
  },
  from: {
    type: Schema.Types.ObjectId,
    ref: 'Address'
  },
  to: {
    type: Schema.Types.ObjectId,
    ref: 'Address'
  },
  txHash: String,
  logIndex: String,
  tokenId: String,
  amount: String,
});

export const CollectionSchema = new Schema({
  token: {
    type: Schema.Types.ObjectId,
    ref: 'Token'
  },
  tokenId: String,
  holders: String,
  totalSupply: String,
});

export const ChainModel = mongoose.model("Chain", ChainSchema);
export const AddressModel = mongoose.model("Address", AddressSchema);
export const TokenModel = mongoose.model("Token", TokenSchema);
export const TransferModel = mongoose.model("Transfer", TransferSchema);
export const CollectionModel = mongoose.model("Collection", CollectionSchema);

export type Chain = InferSchemaType<typeof ChainSchema>;
export type Address = InferSchemaType<typeof AddressSchema>;
export type Token = InferSchemaType<typeof TokenSchema>;
export type Transfer = InferSchemaType<typeof TransferSchema>;
export type Collection = InferSchemaType<typeof CollectionSchema>;

export type ChainDocument = HydratedDocument<Chain>;
export type AddressDocument = HydratedDocument<Address>;
export type TokenDocument = HydratedDocument<Token>;
export type TransferDocument = HydratedDocument<Transfer>;
export type CollectionDocument = HydratedDocument<Collection>;

export type Balance = {
  token: TokenDocument;
  tokenId?: string,
  amount?: number
};
