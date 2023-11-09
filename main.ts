import { ChainModel } from './db.ts';
import Server from './server.ts';

const chains = await ChainModel.find({});
chains.forEach((chain) => {
  const server = new Server(Number(chain.chainId));
  server.bootstrap();
});
