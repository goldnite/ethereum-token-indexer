import { createPublicClient, PublicClient, http, webSocket } from 'npm:viem';
import { mainnet } from 'npm:viem/chains';
import { chains } from './chains.ts';
import { chain, Chain } from './db.ts';

export const erc20AndErc721TokenTransferFirstTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const erc1155SingleTransferSignature =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
export const erc1155BatchTransferSignature =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

export default class Server {
  chainId: number;
  client!: PublicClient;
  chain!: Chain;

  constructor(chainId: number = 1) {
    this.chainId = chainId;
  }
  async bootstrap() {
    console.log('Starting server.');
    this.client = createPublicClient({
      chain: chains[this.chainId],
      transport: webSocket()
    });
    if (!this.client) {
      console.error("Failed to initialize client.");
      return 0;
    }
    this.chain = (await chain.findOne({ chainId: this.chainId })) ||
      (await chain.insertOne({
        chainId: this.chainId,
        blockNumber: '0',
        currency: chains[this.chainId].nativeCurrency.symbol,
      }) as Chain);
    if (!this.chain) {
      console.log("Failed to load database.");
      return 0;
    }
    this.startCatchupIndexer();
    console.log(`Server with chainId ${this.chainId} bootstrapped.`);
  }
  async startCatchupIndexer() {
    console.log(`Starting catch-up indexer ${this.chainId}.`);
    const latestBlockNumber = (await this.client?.getBlockNumber()) || BigInt(0);
    let currentBlockNumber = BigInt(this.chain.blockNumber);
    while (currentBlockNumber <= latestBlockNumber) {
      try {
        const block = await this.client.getBlock({ blockNumber: currentBlockNumber, includeTransactions: true });
        for (let i = 0; i < block.transactions.length; i++) {
          const tx = block.transactions[i];
          const txReceipt = await this.client.getTransactionReceipt({ hash: tx.hash });
          const logs = txReceipt.logs.filter((log) => {
            log.topics[0] === erc20AndErc721TokenTransferFirstTopic &&
              log.topics[1] &&
              log.topics[2] &&
              !log.topics[3]
          });
          for (let j = 0; j < logs.length; j++) {
            const log = logs[i];
            console.log('log :>> ', log);
          }
        }
        this.chain.blockNumber = currentBlockNumber.toString();
        // await chain.updateOne({ chainId: this.chainId }, { $set: { blockNumber: this.chain.blockNumber } });
        // currentBlockNumber++;
      } catch (error) {
        console.error(`Error fetching block ${currentBlockNumber}: ${error.message}`);
        continue;
      }
    }
  }
}
