
import { chain, address, token } from './db.ts';

const chainIds = await chain.insertMany([
  {
    chainId: 813,
    blockNumber: '0',
    currency: 'MEER',
  },
]);
