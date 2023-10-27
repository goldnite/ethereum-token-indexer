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
  ChainModel,
  AddressModel,
  TokenModel,
} from './db.ts';

export const ERC721_interfaceId = '0x80ac58cd';
export const ERC1155_interfaceId = '0xd9b67a26';

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
  chain!: any;


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
    this.chain = await ChainModel.findOne({ chainId: this.chainId });
    this.startCatchupIndexer();
    console.log(`Server with chainId ${this.chainId} bootstrapped.`);
  }
  async startCatchupIndexer() {
    console.log(`Starting catch-up indexer ${this.chainId}.`);
    const latestBlockNumber = (await this.client?.getBlockNumber()) || BigInt(0);
    console.log('latestBlockNumber :>> ', latestBlockNumber);
    let currentBlockNumber = BigInt(this.chain.blockNumber);
    currentBlockNumber = 541759n;
    while (currentBlockNumber <= latestBlockNumber) {
      console.log(`Processing block ${currentBlockNumber}`);
      // try {
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
          const data = await this.client.multicall({
            contracts: [{
              address: tokenAddress.hash as Address,
              abi: ERC721Abi as Abi,
              args: [ERC721_interfaceId],
              functionName: 'supportsInterface',
            }, {
              address: tokenAddress.hash as Address,
              abi: ERC1155Abi as Abi,
              args: [ERC1155_interfaceId],
              functionName: 'supportsInterface',
            }]
          });
          if (data[0].status == 'failure' && data[1].status == "failure") {
            // TODO: have to handle WETH
            /*
            const token = await this.upsertToken(tokenAddress, "ERC20");
            const amount = BigInt(log.topics[2]!);
            const changeBalance = async (address: any, token: any, amount: bigint, isIncrease: boolean) => {
              const index = address.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash);
              console.log('index :>> ', index);
              if (isIncrease) {
                if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + amount).toString();
                else address.balances.push({ token, amount: amount.toString() });
              }
              else {
                address.balances[index].amount = (BigInt(address.balances[index].amount) + amount).toString();
                if (address.balances[index].amount == "0") address.balances.splice(index, 1);
              }
              await address.save();
              await token.save();
            }
            console.log('from :>> ', from);
            console.log('to :>> ', to);
            console.log('amount :>> ', amount);
            console.log('token.symbol :>> ', token.symbol);
            if (from.hash == zeroAddress) {
              changeBalance(to, token, amount, true);
              token.totalSupply = (BigInt(token.totalSupply!) + amount).toString();
            }
            else if (to.hash == zeroAddress) {
              await changeBalance(from, token, amount, false);
              token.totalSupply = (BigInt(token.totalSupply!) - amount).toString();
            }
            else {
              await changeBalance(from, token, amount, false);
              await changeBalance(to, token, amount, true);
            }
            await token.save();*/
          }
          else if (data[0].result == true) {  // ERC721
            const token = await this.upsertToken(tokenAddress, "ERC721");
            const tokenId = BigInt(log.topics[2]!).toString();
            if (from.hash == zeroAddress) {
              from.balances.push({ token, tokenId });
              token.totalSupply = (BigInt(token.totalSupply!) + 1n).toString();
            }
            else if (to.hash == zeroAddress) {
              const index = to.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash && balance.tokenId == tokenId);
              to.balances.splice(index, 1);
              token.totalSupply = (BigInt(token.totalSupply!) - 1n).toString();
            } else {
              const index = from.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash && balance.tokenId == tokenId);
              from.balances.splice(index, 1);
              to.balances.push({ token, tokenId });
            }
            await from.save();
            await to.save();
            await token.save()
          }
          else if (data[1].result == true) {  // ERC1155
          }
        }

      }
      console.log(`Processed block ${currentBlockNumber}`);
      this.chain.blockNumber = currentBlockNumber.toString();
      await this.chain.save();
      currentBlockNumber++;
      // } catch (error) {
      //   console.error(`Error fetching block ${currentBlockNumber}: ${error.message}`);
      //   continue;
      // }
    }
  }
  async upsertAddress(hash: Address) {
    let address = await AddressModel.findOne({ hash }).populate({
      path: 'chain'
    }).populate({
      path: 'balances',
      populate: {
        path: 'token',
        populate: 'address'
      }
    }).exec();
    if (!address) {
      address = new AddressModel({
        hash,
        chain: this.chain,
        balances: []
      });
      await address.save();
    }
    return address;
  }
  async upsertToken(tokenAddress: any, tokenType: string) {
    let token = await TokenModel.findOne({ address: tokenAddress }).populate("address").exec();
    if (!token) {
      const metadata = await this.client.multicall({
        contracts: [
          {
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
      token = new TokenModel({
        type: tokenType,
        address: tokenAddress,
        holders: "0",
        name: String(metadata[0].result!),
        symbol: String(metadata[1].result!),
        totalSupply: "0"
      });
      await token.save();
    }
    return token;
  }
}
