import { chain, address, token } from './db.ts';
import { qitmeer } from "./chains.ts";
import Server from './server.ts';

const chains = chain.find();
console.log('chains :>> ', chains);
chains.forEach((chain) => {
  const server = new Server(Number(chain.chainId));
  server.bootstrap();
}
);