import {
  createPublicClient,
  PublicClient,
  webSocket,
  zeroAddress,
  decodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Abi,
  keccak256,
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
export const erc1155SingleTransferFirstTopic =
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
export const erc1155BatchTransferFirstTopic =
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
export const WETHDepositFirstTopic =
  '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
export const WETHWithdrawalFirstTopic =
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

export default class Server {
  chainId: number;
  client!: PublicClient;
  chain!: any;
  flagERC20 = true;
  flagERC721 = true;
  flagERC1155 = true;

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
    this.startIndexer();
    console.log(`Server with chainId ${this.chainId} bootstrapped.`);
  }
  async startIndexer() {
    console.log(`Starting catch-up indexer ${this.chainId}.`);
    let latestBlockNumber = (await this.client?.getBlockNumber()) || BigInt(0);
    this.client.watchBlockNumber({ onBlockNumber: blockNumber => latestBlockNumber = blockNumber });
    let currentBlockNumber = BigInt(this.chain.blockNumber);
    while (true) {
      if (currentBlockNumber <= latestBlockNumber) {
        console.log(`Processing block ${currentBlockNumber}`);
        // try {
        await this.processBlock(currentBlockNumber);
        console.log(`Processed block ${currentBlockNumber}`);
        currentBlockNumber++;
        this.chain.blockNumber = (currentBlockNumber).toString();
        await this.chain.save();
        // } catch (error) {
        //   console.error(`Error fetching block ${currentBlockNumber}: ${error.message}`);
        //   continue;
        // }
      }
    }
  }
  async processBlock(blockNumber: bigint) {
    const block = await this.client.getBlock({ blockNumber, includeTransactions: true });
    for (const tx of block.transactions) {
      const txReceipt = await this.client.getTransactionReceipt({ hash: tx.hash });
      for (const log of txReceipt.logs) {
        if (this.flagERC20 && this.chain.wrappedNativeCurrencies.includes(log.address) && log.topics[0] === WETHDepositFirstTopic && log.topics[1] && !log.topics[2]) { // WETH deposit
          const [dstAddress] = decodeAbiParameters(parseAbiParameters('address dst'), log.topics[1]);
          const [wad] = decodeAbiParameters(parseAbiParameters('uint256 wad'), log.data);
          console.log('log :>> ', log);
          console.log('dstAddress :>> ', dstAddress);
          console.log('wad :>> ', wad);
          const dst = await this.upsertAddress(dstAddress);
          const tokenAddress = await this.upsertAddress(log.address);
          const token = await this.upsertToken(tokenAddress, "ERC20");
          if (!token) continue;
          const index = dst.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash);
          if (index >= 0) dst.balances[index].amount = (BigInt(dst.balances[index].amount) + wad).toString();
          else {
            dst.balances.push({ token, amount: wad.toString() });
            token.holders = (BigInt(token.holders!) + 1n).toString();
          }
          await dst.save();
          await token.save();
          console.log('dst :>> ', dst);
          console.log('token :>> ', token);
        }
        else if (this.flagERC20 && this.chain.wrappedNativeCurrencies.includes(log.address) && log.topics[0] === WETHWithdrawalFirstTopic && log.topics[1] && !log.topics[2]) { // WETH withdrawal
          const [srcAddress] = decodeAbiParameters(parseAbiParameters('address dst'), log.topics[1]);
          const [wad] = decodeAbiParameters(parseAbiParameters('uint256 wad'), log.data);
          console.log('log :>> ', log);
          console.log('srcAddress :>> ', srcAddress);
          console.log('wad :>> ', wad);
          const src = await this.upsertAddress(srcAddress);
          const tokenAddress = await this.upsertAddress(log.address);
          const token = await this.upsertToken(tokenAddress, "ERC20");
          if (!token) continue;
          const index = src.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash);
          if (index >= 0) {
            src.balances[index].amount = (BigInt(src.balances[index].amount) + wad).toString();
            if (src.balances[index].amount == "0") {
              src.balances.splice(index, 1);
              token.holders = (BigInt(token.holders!) - 1n).toString();
            }
          }
          await src.save();
          await token.save();
          console.log('src :>> ', src);
          console.log('token :>> ', token);
        }
        else if (this.flagERC20 && log.topics[0] === erc20AndErc721TokenTransferFirstTopic && log.topics[1] && log.topics[2] && !log.topics[3]) { // ERC20 Transfer
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[1]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[2]);
          const [amount] = decodeAbiParameters(parseAbiParameters('uint256 amount'), log.data);
          console.log('log :>> ', log);
          console.log('fromAddress :>> ', fromAddress);
          console.log('toAddress :>> ', toAddress);
          console.log('amount :>> ', amount);
          const from = await this.upsertAddress(fromAddress);
          const to = await this.upsertAddress(toAddress);
          const tokenAddress = await this.upsertAddress(log.address);
          const token = await this.upsertToken(tokenAddress, "ERC20");
          if (!token) continue;
          const changeBalance = (address: any, token: any, amount: bigint, isIncrease: boolean) => {
            const index = address.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash);
            console.log('index :>> ', index);
            if (isIncrease) {
              if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + amount).toString();
              else {
                address.balances.push({ token, amount: amount.toString() });
                token.holders = (BigInt(token.holders) + 1n).toString();
              }
            }
            else if (index >= 0) {
              address.balances[index].amount = (BigInt(address.balances[index].amount) + amount).toString();
              if (address.balances[index].amount == "0") {
                address.balances.splice(index, 1);
                token.holders = (BigInt(token.holders) - 1n).toString();
              }
            }
          }
          if (from.hash == zeroAddress) {
            changeBalance(to, token, amount, true);
            token.totalSupply = (BigInt(token.totalSupply!) + amount).toString();
          }
          else if (to.hash == zeroAddress) {
            changeBalance(from, token, amount, false);
            token.totalSupply = (BigInt(token.totalSupply!) - amount).toString();
          }
          else {
            changeBalance(from, token, amount, false);
            changeBalance(to, token, amount, true);
          }
          await from.save();
          await to.save();
          await token.save();
          console.log('from :>> ', from);
          console.log('to :>> ', to);
          console.log('amount :>> ', amount);
          console.log('token :>> ', token);
        }
        else if (this.flagERC721 && log.topics[0] === erc20AndErc721TokenTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC721
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[1]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[2]);
          const [tokenId] = decodeAbiParameters(parseAbiParameters('uint256 tokenId'), log.topics[3]);
          console.log('log :>> ', log);
          console.log('fromAddress :>> ', fromAddress);
          console.log('toAddress :>> ', toAddress);
          console.log('tokenId :>> ', tokenId);
          const from = await this.upsertAddress(fromAddress);
          const to = await this.upsertAddress(toAddress);
          const tokenAddress = await this.upsertAddress(log.address);
          const token = await this.upsertToken(tokenAddress, "ERC721");
          if (!token) continue;
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
          console.log('from :>> ', from);
          console.log('to :>> ', to);
          console.log('tokenId :>> ', tokenId);
          console.log('token :>> ', token);
        }
        else if (this.flagERC1155 && log.topics[0] === erc1155SingleTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC1155 Single Transfer
          const [operatorAddress] = decodeAbiParameters(parseAbiParameters('address operator'), log.topics[1]);
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[2]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[3]);
          const [id, value] = decodeAbiParameters(parseAbiParameters('uint256 id, uint256 value'), log.data);
          console.log('log :>> ', log);
          console.log('fromAddress :>> ', fromAddress);
          console.log('toAddress :>> ', toAddress);
          console.log('id :>> ', id);
          console.log('value :>> ', value);
          await this.upsertAddress(operatorAddress);
          const from = await this.upsertAddress(fromAddress);
          const to = await this.upsertAddress(toAddress);
          const tokenAddress = await this.upsertAddress(log.address);
          const token = await this.upsertToken(tokenAddress, "ERC1155");
          if (!token) continue;
          const changeBalance = (address: any, token: any, tokenId: bigint, value: bigint, isIncrease: boolean) => {
            const index = address.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash && balance.tokenId == tokenId);
            console.log('index :>> ', index);
            if (isIncrease) {
              if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
              else {
                address.balances.push({ token, tokenId, amount: value.toString() });
                token.holders = (BigInt(token.holders) + 1n).toString();
              }
            }
            else if (index >= 0) {
              address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
              if (address.balances[index].amount == "0") {
                address.balances.splice(index, 1);
                token.holders = (BigInt(token.holders) - 1n).toString();
              }
            }
          }
          if (from.hash == zeroAddress) {
            changeBalance(to, token, id, value, true);
          }
          else if (to.hash == zeroAddress) {
            changeBalance(from, token, id, value, false);
          }
          else {
            changeBalance(from, token, id, value, false);
            changeBalance(to, token, id, value, true);
          }
          await from.save();
          await to.save();
          await token.save();
          console.log('from :>> ', from);
          console.log('to :>> ', to);
          console.log('id :>> ', id);
          console.log('value :>> ', value);
        }
        else if (this.flagERC1155 && log.topics[0] === erc1155BatchTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC1155 Batch Transfer
          const [operatorAddress] = decodeAbiParameters(parseAbiParameters('address operator'), log.topics[1]);
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[2]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[3]);
          const [ids, values] = decodeAbiParameters(parseAbiParameters('uint256[] ids, uint256[] values'), log.data);
          console.log('log :>> ', log);
          console.log('fromAddress :>> ', fromAddress);
          console.log('toAddress :>> ', toAddress);
          console.log('ids :>> ', ids);
          console.log('values :>> ', values);
          await this.upsertAddress(operatorAddress);
          const from = await this.upsertAddress(fromAddress);
          const to = await this.upsertAddress(toAddress);
          const tokenAddress = await this.upsertAddress(log.address);
          const token = await this.upsertToken(tokenAddress, "ERC1155");
          if (!token) continue;
          const changeBalance = (address: any, token: any, tokenIds: readonly bigint[], values: readonly bigint[], isIncrease: boolean) => {
            for (let i = 0; i < tokenIds.length; i++) {
              const tokenId = tokenIds[i];
              const value = values[i];
              const index = address.balances.findIndex((balance: any) => balance.token.address.hash == token.address.hash && balance.tokenId == tokenId);
              console.log('index :>> ', index);
              if (isIncrease) {
                if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
                else {
                  address.balances.push({ token, tokenId, amount: value.toString() });
                  token.holders = (BigInt(token.holders) + 1n).toString();
                }
              }
              else if (index >= 0) {
                address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
                if (address.balances[index].amount == "0") {
                  address.balances.splice(index, 1);
                  token.holders = (BigInt(token.holders) - 1n).toString();
                }
              }
            }
          }
          if (from.hash == zeroAddress) {
            changeBalance(to, token, ids, values, true);
          }
          else if (to.hash == zeroAddress) {
            changeBalance(from, token, ids, values, false);
          }
          else {
            changeBalance(from, token, ids, values, false);
            changeBalance(to, token, ids, values, true);
          }
          await from.save();
          await to.save();
          await token.save();
          console.log('from :>> ', from);
          console.log('to :>> ', to);
          console.log('id :>> ', ids);
          console.log('value :>> ', values);
        }
      }
    }
  }
  async upsertAddress(hash: Address) {
    hash = hash.toLowerCase() as Address;
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
      const data = await this.client.multicall({
        contracts: [
          {
            address: tokenAddress.hash as Address,
            abi: ERC721Abi as Abi,
            args: [ERC721_interfaceId],
            functionName: 'supportsInterface',
          }, {
            address: tokenAddress.hash as Address,
            abi: ERC1155Abi as Abi,
            args: [ERC1155_interfaceId],
            functionName: 'supportsInterface',
          },
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
      });
      console.log('data :>> ', data);
      const isERC721 = data[0].status === 'success' && data[0].result == true;
      const isERC1155 = data[1].status === 'success' && data[1].result == true;
      const metadata = {
        name: data[2].status === "success" ? String(data[2].result) : "",
        symbol: data[3].status === "success" ? String(data[3].result) : "",
      }
      switch (tokenType) {
        case 'ERC20':
          token = new TokenModel({
            type: tokenType,
            address: tokenAddress,
            holders: "0",
            name: metadata.name,
            symbol: metadata.symbol,
            totalSupply: "0"
          });
          break;
        case 'ERC721':
          if (isERC721)
            token = new TokenModel({
              type: tokenType,
              address: tokenAddress,
              holders: "0",
              name: metadata.name,
              symbol: metadata.symbol,
              totalSupply: "0"
            });
          break;
        case 'ERC1155':
          if (isERC1155)
            token = new TokenModel({
              type: tokenType,
              address: tokenAddress,
              holders: "0",
              totalSupply: "0"
            });
          break;
        default:
          break;
      }
    }
    return token;
  }
}
