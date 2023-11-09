import { defineChain } from 'npm:viem';

export const qitmeer = defineChain({
  id: 813,
  name: 'Qitmeer',
  network: 'qitmeer',
  nativeCurrency: {
    decimals: 18,
    name: 'MEER',
    symbol: 'MEER',
  },
  wrappedNativeCurrencies: [
    '0x470cbfb236860eb5257bbf78715fb5bd77119c2f'
  ],
  rpcUrls: {
    default: {
      http: ['https://qng.rpc.qitmeer.io'],
      webSocket: ['wss://qng.rpc.qitmeer.io'],
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
})
// deno-lint-ignore no-explicit-any
export const chains: Record<string, any> = {
  "813": qitmeer,
};
