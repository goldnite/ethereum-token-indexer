
import { chainModel, addressModel, tokenModel } from './db.ts';

const chainIds = await chainModel.insertMany([
  {
    chainId: 813,
    blockNumber: '0',
    currency: 'MEER',
  },
]);
