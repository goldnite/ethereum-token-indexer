import {
  createPublicClient,
  PublicClient,
  http,
  webSocket,
  zeroAddress,
  decodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Abi,
} from 'npm:viem';
import ERC20Abi from './abis/ERC20.abi.json' with { type: "json" };
import ERC721Abi from './abis/ERC721.abi.json' with { type: "json" };
import ERC1155Abi from './abis/ERC1155.abi.json' with { type: "json" };
import { chains } from './chains.ts';
import {
  ChainModel,
  AddressModel,
  TokenModel,
  type ChainDocument,
  type AddressDocument,
  type TokenDocument,
} from './db.ts';
import {
  ERC721_interfaceId,
  ERC1155_interfaceId,
  erc20AndErc721TokenTransferFirstTopic,
  erc1155SingleTransferFirstTopic,
  erc1155BatchTransferFirstTopic,
  WETHDepositFirstTopic,
  WETHWithdrawalFirstTopic,
} from './constants.ts';
import { logger } from "./logger.ts";

export default class Server {
  chainId: number;
  client!: PublicClient;
  chain!: ChainDocument;
  flagERC20 = true;
  flagERC721 = true;
  flagERC1155 = true;

  constructor(chainId: number = 1) {
    this.chainId = chainId;
  }
  async bootstrap() {
    logger.info('Starting server.');
    this.client = createPublicClient({
      chain: chains[this.chainId],
      transport: http()
    });
    if (!this.client) {
      logger.error('Failed to initialize client.');
      return 0;
    }
    this.chain = await ChainModel.findOne({ chainId: this.chainId }) as ChainDocument;
    this.startIndexer();
    logger.info(`Server with chainId ${this.chainId} bootstrapped.`);
  }
  async startIndexer() {
    logger.info(`Starting catch-up indexer ${this.chainId}.`);
    let latestBlockNumber = (await this.client?.getBlockNumber()) || BigInt(0);
    this.client.watchBlockNumber({ onBlockNumber: blockNumber => latestBlockNumber = blockNumber, poll: true });
    let currentBlockNumber = BigInt(this.chain.blockNumber!);
    while (true) {
      if (currentBlockNumber <= latestBlockNumber) {
        logger.info(`Processing block ${currentBlockNumber}`);
        // try {
        await this.processBlock(currentBlockNumber);
        logger.info(`Processed block ${currentBlockNumber}`);
        currentBlockNumber++;
        this.chain.blockNumber = (currentBlockNumber).toString();
        await this.chain.save();
        // } catch (error) {
        //   logger.error(`Error fetching block ${currentBlockNumber}: ${error.message}`);
        //   continue;
        // }
      }
    }
  }
  async processBlock(blockNumber: bigint) {
    const block = await this.client.getBlock({ blockNumber, includeTransactions: true });
    function upsertArray(arr: AddressDocument[] | TokenDocument[], item: AddressDocument | TokenDocument) {
      const index = arr.findIndex((element: AddressDocument | TokenDocument) => element._id === item._id);
      if (index >= 0) arr[index] = item;
      // deno-lint-ignore no-explicit-any
      else arr.push(item as any);
    }
    const addresses: AddressDocument[] = [];
    const tokens: TokenDocument[] = [];
    for (const tx of block.transactions) {
      const txReceipt = await this.client.getTransactionReceipt({ hash: tx.hash });
      for (const log of txReceipt.logs) {
        if (this.flagERC20 && this.chain.wrappedNativeCurrencies.includes(log.address) && log.topics[0] === WETHDepositFirstTopic && log.topics[1] && !log.topics[2]) { // WETH deposit
          const [dstAddress] = decodeAbiParameters(parseAbiParameters('address dst'), log.topics[1]);
          const [wad] = decodeAbiParameters(parseAbiParameters('uint256 wad'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('dstAddress :>> ' + dstAddress);
          logger.debug('wad :>> ' + wad);
          const dst = await this.upsertAddress(addresses, dstAddress);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC20");
          if (!token) continue;
          // deno-lint-ignore no-explicit-any
          const index = dst.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash);
          if (index >= 0) dst.balances[index].amount = (BigInt(dst.balances[index].amount) + wad).toString();
          else {
            dst.balances.push({ token, amount: wad.toString() });
            token.holders = (BigInt(token.holders!) + 1n).toString();
          }
          upsertArray(addresses, dst);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('dst :>> ' + dst);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC20 && this.chain.wrappedNativeCurrencies.includes(log.address) && log.topics[0] === WETHWithdrawalFirstTopic && log.topics[1] && !log.topics[2]) { // WETH withdrawal
          const [srcAddress] = decodeAbiParameters(parseAbiParameters('address dst'), log.topics[1]);
          const [wad] = decodeAbiParameters(parseAbiParameters('uint256 wad'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('srcAddress :>> ' + srcAddress);
          logger.debug('wad :>> ' + wad);
          const src = await this.upsertAddress(addresses, srcAddress);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC20");
          if (!token) continue;
          // deno-lint-ignore no-explicit-any
          const index = src.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash);
          if (index >= 0) {
            src.balances[index].amount = (BigInt(src.balances[index].amount) + wad).toString();
            if (src.balances[index].amount === "0") {
              src.balances.splice(index, 1);
              token.holders = (BigInt(token.holders!) - 1n).toString();
            }
          }
          upsertArray(addresses, src);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('src :>> ' + src);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC20 && log.topics[0] === erc20AndErc721TokenTransferFirstTopic && log.topics[1] && log.topics[2] && !log.topics[3]) { // ERC20 Transfer
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[1]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[2]);
          const [amount] = decodeAbiParameters(parseAbiParameters('uint256 amount'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + fromAddress);
          logger.debug('toAddress :>> ' + toAddress);
          logger.debug('amount :>> ' + amount);
          const from = await this.upsertAddress(addresses, fromAddress);
          const to = await this.upsertAddress(addresses, toAddress);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC20");
          if (!token) continue;
          const updateBalance = (address: AddressDocument, token: TokenDocument, amount: bigint, isIncrease: boolean) => {
            // deno-lint-ignore no-explicit-any
            const index = address.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash);
            logger.debug('index :>> ' + index);
            if (isIncrease) {
              if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + amount).toString();
              else {
                address.balances.push({ token, amount: amount.toString() });
                token.holders = (BigInt(token.holders!) + 1n).toString();
              }
            }
            else if (index >= 0) {
              address.balances[index].amount = (BigInt(address.balances[index].amount) + amount).toString();
              if (address.balances[index].amount === "0") {
                address.balances.splice(index, 1);
                token.holders = (BigInt(token.holders!) - 1n).toString();
              }
            }
          }
          if (from.hash === zeroAddress) {
            updateBalance(to, token, amount, true);
            token.totalSupply = (BigInt(token.totalSupply!) + amount).toString();
          }
          else if (to.hash === zeroAddress) {
            updateBalance(from, token, amount, false);
            token.totalSupply = (BigInt(token.totalSupply!) - amount).toString();
          }
          else {
            updateBalance(from, token, amount, false);
            updateBalance(to, token, amount, true);
          }
          upsertArray(addresses, from);
          upsertArray(addresses, to);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + from);
          logger.debug('to :>> ' + to);
          logger.debug('amount :>> ' + amount);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC721 && log.topics[0] === erc20AndErc721TokenTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC721
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[1]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[2]);
          const [tokenId] = decodeAbiParameters(parseAbiParameters('uint256 tokenId'), log.topics[3]);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + fromAddress);
          logger.debug('toAddress :>> ' + toAddress);
          logger.debug('tokenId :>> ' + tokenId);
          const from = await this.upsertAddress(addresses, fromAddress);
          const to = await this.upsertAddress(addresses, toAddress);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC721");
          if (!token) continue;
          if (from.hash === zeroAddress) {
            from.balances.push({ token, tokenId });
            token.totalSupply = (BigInt(token.totalSupply!) + 1n).toString();
          }
          else if (to.hash === zeroAddress) {
            // deno-lint-ignore no-explicit-any
            const index = to.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash && balance.tokenId === tokenId);
            to.balances.splice(index, 1);
            token.totalSupply = (BigInt(token.totalSupply!) - 1n).toString();
          } else {
            // deno-lint-ignore no-explicit-any
            const index = from.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash && balance.tokenId === tokenId);
            from.balances.splice(index, 1);
            to.balances.push({ token, tokenId });
          }
          upsertArray(addresses, from);
          upsertArray(addresses, to);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + from);
          logger.debug('to :>> ' + to);
          logger.debug('tokenId :>> ' + tokenId);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC1155 && log.topics[0] === erc1155SingleTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC1155 Single Transfer
          const [operatorAddress] = decodeAbiParameters(parseAbiParameters('address operator'), log.topics[1]);
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[2]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[3]);
          const [id, value] = decodeAbiParameters(parseAbiParameters('uint256 id, uint256 value'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + fromAddress);
          logger.debug('toAddress :>> ' + toAddress);
          logger.debug('id :>> ' + id);
          logger.debug('value :>> ' + value);
          await this.upsertAddress(addresses, operatorAddress);
          const from = await this.upsertAddress(addresses, fromAddress);
          const to = await this.upsertAddress(addresses, toAddress);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC1155");
          if (!token) continue;
          const updateBalance = (address: AddressDocument, token: TokenDocument, tokenId: bigint, value: bigint, isIncrease: boolean) => {
            // deno-lint-ignore no-explicit-any
            const index = address.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash && balance.tokenId === tokenId);
            logger.debug('index :>> ' + index);
            if (isIncrease) {
              if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
              else {
                address.balances.push({ token, tokenId, amount: value.toString() });
                token.holders = (BigInt(token.holders!) + 1n).toString();
              }
            }
            else if (index >= 0) {
              address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
              if (address.balances[index].amount === "0") {
                address.balances.splice(index, 1);
                token.holders = (BigInt(token.holders!) - 1n).toString();
              }
            }
          }
          if (from.hash === zeroAddress) {
            updateBalance(to, token, id, value, true);
          }
          else if (to.hash === zeroAddress) {
            updateBalance(from, token, id, value, false);
          }
          else {
            updateBalance(from, token, id, value, false);
            updateBalance(to, token, id, value, true);
          }
          upsertArray(addresses, from);
          upsertArray(addresses, to);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + from);
          logger.debug('to :>> ' + to);
          logger.debug('id :>> ' + id);
          logger.debug('value :>> ' + value);
        }
        else if (this.flagERC1155 && log.topics[0] === erc1155BatchTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC1155 Batch Transfer
          const [operatorAddress] = decodeAbiParameters(parseAbiParameters('address operator'), log.topics[1]);
          const [fromAddress] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[2]);
          const [toAddress] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[3]);
          const [ids, values] = decodeAbiParameters(parseAbiParameters('uint256[] ids, uint256[] values'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + fromAddress);
          logger.debug('toAddress :>> ' + toAddress);
          logger.debug('ids :>> ' + ids);
          logger.debug('values :>> ' + values);
          await this.upsertAddress(addresses, operatorAddress);
          const from = await this.upsertAddress(addresses, fromAddress);
          const to = await this.upsertAddress(addresses, toAddress);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC1155");
          if (!token) continue;
          const updateBalance = (address: AddressDocument, token: TokenDocument, tokenIds: readonly bigint[], values: readonly bigint[], isIncrease: boolean) => {
            for (let i = 0; i < tokenIds.length; i++) {
              const tokenId = tokenIds[i];
              const value = values[i];
              // deno-lint-ignore no-explicit-any
              const index = address.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash && balance.tokenId === tokenId);
              logger.debug('index :>> ' + index);
              if (isIncrease) {
                if (index >= 0) address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
                else {
                  address.balances.push({ token, tokenId, amount: value.toString() });
                  token.holders = (BigInt(token.holders!) + 1n).toString();
                }
              }
              else if (index >= 0) {
                address.balances[index].amount = (BigInt(address.balances[index].amount) + value).toString();
                if (address.balances[index].amount === "0") {
                  address.balances.splice(index, 1);
                  token.holders = (BigInt(token.holders!) - 1n).toString();
                }
              }
            }
          }
          if (from.hash === zeroAddress) {
            updateBalance(to, token, ids, values, true);
          }
          else if (to.hash === zeroAddress) {
            updateBalance(from, token, ids, values, false);
          }
          else {
            updateBalance(from, token, ids, values, false);
            updateBalance(to, token, ids, values, true);
          }
          upsertArray(addresses, from);
          upsertArray(addresses, to);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + from);
          logger.debug('to :>> ' + to);
          logger.debug('id :>> ' + ids);
          logger.debug('value :>> ' + values);
        }
      }
    }
    await AddressModel.bulkSave(addresses);
    await TokenModel.bulkSave(tokens);
  }
  async upsertAddress(addresses: AddressDocument[], hash: Address) {
    hash = hash.toLowerCase() as Address;
    const index = addresses.findIndex((element: AddressDocument) => element.hash === hash);
    if (index >= 0) return addresses[index];
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
    }
    return address;
  }
  async upsertToken(tokens: TokenDocument[], tokenAddress: AddressDocument, tokenType: string) {
    const index = tokens.findIndex((element: TokenDocument) => element.address.hash === tokenAddress.hash);
    if (index >= 0) return tokens[index];
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
      const isERC721 = data[0].status === 'success' && data[0].result === true;
      const isERC1155 = data[1].status === 'success' && data[1].result === true;
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
            totalSupply: "0",
            chain: this.chain,
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
              totalSupply: "0",
              chain: this.chain,
            });
          break;
        case 'ERC1155':
          if (isERC1155)
            token = new TokenModel({
              type: tokenType,
              address: tokenAddress,
              holders: "0",
              totalSupply: "0",
              chain: this.chain,
            });
          break;
        default:
          break;
      }
    }
    return token;
  }
}
