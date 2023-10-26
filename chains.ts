import { defineChain, } from 'npm:viem';

export const qitmeer = defineChain({
  id: 813,
  name: 'Qitmeer',
  network: 'qitmeer',
  nativeCurrency: {
    decimals: 18,
    name: 'MEER',
    symbol: 'MEER',
  },
  rpcUrls: {
    default: {
      http: ['https://qng.rpc.qitmeer.io'],
      webSocket: ['wss://qng.rpc.qitmeer.io'],
    },
    public: {
      http: ['https://mainnet.meerlabs.com', 'https://rpc.dimai.ai', 'https://https://rpc.woowow.io'],
      webSocket: ['wss://mainnet.meerlabs.com', 'wss://rpc.dimai.ai', 'wss://https://rpc.woowow.io'],
    },
  },
  blockExplorers: {
    default: { name: 'Qitmeer Network Explorer', url: 'https://qng.qitmeer.io' },
    public: { name: 'Meerscan', url: 'https://qng.meerscan.io' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 744781,
    },
  },
})
export const chains: Record<number, any> = {
  813: qitmeer,
};
