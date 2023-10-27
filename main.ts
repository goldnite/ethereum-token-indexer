import { ChainModel, AddressModel, TokenModel } from './db.ts';
import { qitmeer } from "./chains.ts";
import Server from './server.ts';

const chains = await ChainModel.find({});
chains.forEach((chain) => {
  const server = new Server(Number(chain.chainId));
  server.bootstrap();
});
