import { defineChain, type Chain } from 'npm:viem';
import { mainnet } from 'npm:viem/chains';

export const wrappedNativeCurrencies: Record<string, string[]> = {
  "813": [
    '0x470cbfb236860eb5257bbf78715fb5bd77119c2f'
  ]
};

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
      http: ['https://rpc.woowow.io'],
      webSocket: ['wss://rpc.woowow.io'],
    },
    public: {
      http: ['https://qng.rpc.qitmeer.io', 'https://mainnet.meerlabs.com', 'https://rpc.dimai.ai', 'https://rpc.woowow.io'],
      webSocket: ['wss://qng.rpc.qitmeer.io', 'wss://mainnet.meerlabs.com', 'wss://rpc.dimai.ai', 'wss://rpc.woowow.io'],
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
});

export const chains: Record<string, Chain> = {
  "813": qitmeer,
};
