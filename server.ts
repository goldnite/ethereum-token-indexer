import {
  createPublicClient,
  PublicClient,
  http,
  webSocket,
  zeroAddress,
  type Address,
  type Abi
} from 'npm:viem';
import ERC20Abi from './abis/ERC20.abi.json' with { type: "json" };
import ERC721Abi from './abis/ERC721.abi.json' with { type: "json" };
import ERC1155Abi from './abis/ERC1155.abi.json' with { type: "json" };
import { chains } from './chains.ts';
import {
  chainModel,
  addressModel,
  tokenModel,
  type ChainSchema,
  type AddressSchema,
  type TokenSchema,
  TokenType
} from './db.ts';

export const ERC721_interfaceId = '0x80ac58cd';

export const erc20AndErc721TokenTransferFirstTopic =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const erc1155SingleTransferSignature =
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
export const erc1155BatchTransferSignature =
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

export function topicToAddress(topic: `0x${string}`): Address {
  return `0x${topic.slice(-40)}` as Address;
}

export default class Server {
  chainId: number;
  client!: PublicClient;
  chain!: ChainSchema;

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
      console.error('Failed to initialize client.');
      return 0;
    }
    this.chain = (await chainModel.findOne({ chainId: this.chainId })) ||
      (await chainModel.insertOne({
        chainId: this.chainId,
        blockNumber: '0',
        currency: chains[this.chainId].nativeCurrency.symbol,
      }) as ChainSchema);
    if (!this.chain) {
      console.log('Failed to load database.');
      return 0;
    }
    this.startCatchupIndexer();
    console.log(`Server with chainId ${this.chainId} bootstrapped.`);
  }
  async startCatchupIndexer() {
    console.log(`Starting catch-up indexer ${this.chainId}.`);
    const latestBlockNumber = (await this.client?.getBlockNumber()) || BigInt(0);
    console.log('latestBlockNumber :>> ', latestBlockNumber);
    let currentBlockNumber = BigInt(this.chain.blockNumber);
    currentBlockNumber = 991353n;
    while (currentBlockNumber <= latestBlockNumber) {
      console.log(`Processing block ${currentBlockNumber}`);
      try {
        const block = await this.client.getBlock({ blockNumber: currentBlockNumber, includeTransactions: true });
        for (let i = 0; i < block.transactions.length; i++) {
          const tx = block.transactions[i];
          const txReceipt = await this.client.getTransactionReceipt({ hash: tx.hash });
          const logs = txReceipt.logs.filter((log) =>
            log.topics[0] === erc20AndErc721TokenTransferFirstTopic &&
            log.topics[1] &&
            log.topics[2] &&
            !log.topics[3]
          );
          for (let j = 0; j < logs.length; j++) {
            const log = logs[j];
            const from = await this.upsertAddress(topicToAddress(log.topics[1]!));
            const to = await this.upsertAddress(topicToAddress(log.topics[2]!));
            const tokenAddress = await this.upsertAddress(log.address);
            const token = await this.upsertToken(tokenAddress);
            let data;
            try {
              data = await this.client.readContract({
                address: tokenAddress.hash as Address,
                abi: ERC721Abi,
                args: [ERC721_interfaceId],
                functionName: 'supportsInterface',
              })
            }
            catch (err) {
              console.log('not ERC721');
            }
            if (data == undefined) // ERC20
            {
              this.upsertToken(tokenAddress);
              // if (from.hash == zeroAddress) {
              //   addressModel.updateOne(
              //     { _id: tokenAddress.id },
              //     { $set: { username: "USERNAME" } },
              //   );
              // }
            }
          }
        }
        console.log(`Processing block ${currentBlockNumber}`);
        return;
        this.chain.blockNumber = currentBlockNumber.toString();
        // currentBlockNumber++;
      } catch (error) {
        console.error(`Error fetching block ${currentBlockNumber}: ${error.message}`);
        continue;
      }
    }
  }
  async upsertAddress(hash: Address) {
    console.log('hash :>> ', hash);
    let address = await addressModel.findOne({ hash });
    if (!address) {
      const id = await addressModel.insertOne({
        hash,
        chain: this.chain._id,
        balances: []
      });
      address = await addressModel.findOne({ _id: id });
    }
    return address as AddressSchema;
  }
  async upsertToken(tokenAddress: AddressSchema) {
    let token = await tokenModel.findOne({ address: tokenAddress });
    console.log(tokenAddress);
    const metadata = await this.client.multicall({
      contracts: [
        {
          address: tokenAddress.hash as Address,
          abi: ERC20Abi as Abi,
          functionName: 'decimals',
        }, {
          address: tokenAddress.hash as Address,
          abi: ERC20Abi as Abi,
          functionName: 'name',
        }, {
          address: tokenAddress.hash as Address,
          abi: ERC20Abi as Abi,
          functionName: 'symbol',
        }
      ]
    })
    console.log(metadata);
    if (!token) {
      const id = await tokenModel.insertOne({
        type: TokenType.ERC20,
        address: tokenAddress._id,
        decimals: Number(metadata[0].result),
        holders: "0",
        name: String(metadata[1].result!),
        symbol: String(metadata[2].result!),
        totalSupply: "0"
      });
      token = await tokenModel.findOne({ _id: id });
    }
    return token as TokenSchema;
  }
}
