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
  chain: {
    type: Schema.Types.ObjectId,
    ref: 'Chain',
  },
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

export const ChainModel = mongoose.model("Chain", ChainSchema,);
export const AddressModel = mongoose.model("Address", AddressSchema);
export const TokenModel = mongoose.model("Token", TokenSchema);

export type Chain = InferSchemaType<typeof ChainSchema>;
export type Address = InferSchemaType<typeof AddressSchema>;
export type Token = InferSchemaType<typeof TokenSchema>;

export type ChainDocument = HydratedDocument<Chain>;
export type AddressDocument = HydratedDocument<Address>;
export type TokenDocument = HydratedDocument<Token>;