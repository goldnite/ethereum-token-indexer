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
  TransferModel,
  type ChainDocument,
  type AddressDocument,
  type TokenDocument,
  CollectionDocument,
  TransferDocument,
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
  zeroAddress!: AddressDocument;
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
    this.zeroAddress = await AddressModel.findOne({
      hash: zeroAddress
    }) as AddressDocument;
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
    const addresses: AddressDocument[] = [this.zeroAddress];
    const tokens: TokenDocument[] = [];
    const collections: CollectionDocument[] = [];
    const transfers: TransferDocument[] = [];
    for (const tx of block.transactions) {
      const txReceipt = await this.client.getTransactionReceipt({ hash: tx.hash });
      for (const log of txReceipt.logs) {
        if (this.flagERC20 && this.chain.wrappedNativeCurrencies.includes(log.address) && log.topics[0] === WETHDepositFirstTopic && log.topics[1] && !log.topics[2]) { // WETH deposit
          const [dst] = decodeAbiParameters(parseAbiParameters('address dst'), log.topics[1]);
          const [wad] = decodeAbiParameters(parseAbiParameters('uint256 wad'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('dstAddress :>> ' + dst);
          logger.debug('wad :>> ' + wad);
          const dstAddress = await this.upsertAddress(addresses, dst);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC20");
          if (!token) continue;
          transfers.push(new TransferModel({
            token,
            from: this.zeroAddress,
            to: dstAddress,
            txHash: tx.hash,
            logIndex: log.logIndex,
            amount: wad.toString()
          }));
          // deno-lint-ignore no-explicit-any
          const index = dstAddress.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash);
          if (index >= 0) dstAddress.balances[index].amount = (BigInt(dstAddress.balances[index].amount) + wad).toString();
          else {
            dstAddress.balances.push({ token, amount: wad.toString() });
            token.holders = (BigInt(token.holders!) + 1n).toString();
          }
          upsertArray(addresses, dstAddress);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('dst :>> ' + dstAddress);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC20 && this.chain.wrappedNativeCurrencies.includes(log.address) && log.topics[0] === WETHWithdrawalFirstTopic && log.topics[1] && !log.topics[2]) { // WETH withdrawal
          const [src] = decodeAbiParameters(parseAbiParameters('address src'), log.topics[1]);
          const [wad] = decodeAbiParameters(parseAbiParameters('uint256 wad'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('srcAddress :>> ' + src);
          logger.debug('wad :>> ' + wad);
          const srcAddress = await this.upsertAddress(addresses, src);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC20");
          if (!token) continue;
          transfers.push(new TransferModel({
            token,
            from: srcAddress,
            to: this.zeroAddress,
            txHash: tx.hash,
            logIndex: log.logIndex,
            amount: wad.toString()
          }));
          // deno-lint-ignore no-explicit-any
          const index = srcAddress.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash);
          if (index >= 0) {
            srcAddress.balances[index].amount = (BigInt(srcAddress.balances[index].amount) + wad).toString();
            if (srcAddress.balances[index].amount === "0") {
              srcAddress.balances.splice(index, 1);
              token.holders = (BigInt(token.holders!) - 1n).toString();
            }
          }
          upsertArray(addresses, srcAddress);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('src :>> ' + srcAddress);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC20 && log.topics[0] === erc20AndErc721TokenTransferFirstTopic && log.topics[1] && log.topics[2] && !log.topics[3]) { // ERC20 Transfer
          const [from] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[1]);
          const [to] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[2]);
          const [amount] = decodeAbiParameters(parseAbiParameters('uint256 amount'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + from);
          logger.debug('toAddress :>> ' + to);
          logger.debug('amount :>> ' + amount);
          const fromAddress = await this.upsertAddress(addresses, from);
          const toAddress = await this.upsertAddress(addresses, to);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC20");
          if (!token) continue;
          transfers.push(new TransferModel({
            token,
            from: fromAddress,
            to: toAddress,
            txHash: tx.hash,
            logIndex: log.logIndex,
            amount: amount.toString()
          }));
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
          if (fromAddress.hash === zeroAddress) {
            updateBalance(toAddress, token, amount, true);
            token.totalSupply = (BigInt(token.totalSupply!) + amount).toString();
          }
          else if (toAddress.hash === zeroAddress) {
            updateBalance(fromAddress, token, amount, false);
            token.totalSupply = (BigInt(token.totalSupply!) - amount).toString();
          }
          else {
            updateBalance(fromAddress, token, amount, false);
            updateBalance(toAddress, token, amount, true);
          }
          upsertArray(addresses, fromAddress);
          upsertArray(addresses, toAddress);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + fromAddress);
          logger.debug('to :>> ' + toAddress);
          logger.debug('amount :>> ' + amount);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC721 && log.topics[0] === erc20AndErc721TokenTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC721
          const [from] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[1]);
          const [to] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[2]);
          const [tokenId] = decodeAbiParameters(parseAbiParameters('uint256 tokenId'), log.topics[3]);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + from);
          logger.debug('toAddress :>> ' + to);
          logger.debug('tokenId :>> ' + tokenId);
          const fromAddress = await this.upsertAddress(addresses, from);
          const toAddress = await this.upsertAddress(addresses, to);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC721");
          if (!token) continue;
          transfers.push(new TransferModel({
            token,
            from: fromAddress,
            to: toAddress,
            txHash: tx.hash,
            logIndex: log.logIndex,
            tokenId: tokenId.toString()
          }));
          if (fromAddress.hash === zeroAddress) {
            fromAddress.balances.push({ token, tokenId });
            token.totalSupply = (BigInt(token.totalSupply!) + 1n).toString();
          }
          else if (toAddress.hash === zeroAddress) {
            // deno-lint-ignore no-explicit-any
            const index = toAddress.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash && balance.tokenId === tokenId);
            toAddress.balances.splice(index, 1);
            token.totalSupply = (BigInt(token.totalSupply!) - 1n).toString();
          } else {
            // deno-lint-ignore no-explicit-any
            const index = fromAddress.balances.findIndex((balance: any) => balance.token.address.hash === token.address.hash && balance.tokenId === tokenId);
            fromAddress.balances.splice(index, 1);
            toAddress.balances.push({ token, tokenId });
          }
          upsertArray(addresses, fromAddress);
          upsertArray(addresses, toAddress);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + fromAddress);
          logger.debug('to :>> ' + toAddress);
          logger.debug('tokenId :>> ' + tokenId);
          logger.debug('token :>> ' + token);
        }
        else if (this.flagERC1155 && log.topics[0] === erc1155SingleTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC1155 Single Transfer
          const [operator] = decodeAbiParameters(parseAbiParameters('address operator'), log.topics[1]);
          const [from] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[2]);
          const [to] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[3]);
          const [id, value] = decodeAbiParameters(parseAbiParameters('uint256 id, uint256 value'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + from);
          logger.debug('toAddress :>> ' + to);
          logger.debug('id :>> ' + id);
          logger.debug('value :>> ' + value);
          const operatorAddress = await this.upsertAddress(addresses, operator);
          const fromAddress = await this.upsertAddress(addresses, from);
          const toAddress = await this.upsertAddress(addresses, to);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC1155");
          if (!token) continue;
          transfers.push(new TransferModel({
            token,
            from: fromAddress,
            to: toAddress,
            txHash: tx.hash,
            logIndex: log.logIndex,
            tokenId: id.toString(),
            amount: value.toString()
          }));
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
          if (fromAddress.hash === zeroAddress) {
            updateBalance(toAddress, token, id, value, true);
          }
          else if (toAddress.hash === zeroAddress) {
            updateBalance(fromAddress, token, id, value, false);
          }
          else {
            updateBalance(fromAddress, token, id, value, false);
            updateBalance(toAddress, token, id, value, true);
          }
          upsertArray(addresses, operatorAddress);
          upsertArray(addresses, fromAddress);
          upsertArray(addresses, toAddress);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + fromAddress);
          logger.debug('to :>> ' + toAddress);
          logger.debug('id :>> ' + id);
          logger.debug('value :>> ' + value);
        }
        else if (this.flagERC1155 && log.topics[0] === erc1155BatchTransferFirstTopic && log.topics[1] && log.topics[2] && log.topics[3]) { // ERC1155 Batch Transfer
          const [operatorAddress] = decodeAbiParameters(parseAbiParameters('address operator'), log.topics[1]);
          const [fromAddress1] = decodeAbiParameters(parseAbiParameters('address from'), log.topics[2]);
          const [toAddress1] = decodeAbiParameters(parseAbiParameters('address to'), log.topics[3]);
          const [ids, values] = decodeAbiParameters(parseAbiParameters('uint256[] ids, uint256[] values'), log.data);
          logger.debug('log :>> ' + log);
          logger.debug('fromAddress :>> ' + fromAddress1);
          logger.debug('toAddress :>> ' + toAddress1);
          logger.debug('ids :>> ' + ids);
          logger.debug('values :>> ' + values);
          await this.upsertAddress(addresses, operatorAddress);
          const fromAddress = await this.upsertAddress(addresses, fromAddress1);
          const toAddress = await this.upsertAddress(addresses, toAddress1);
          const tokenAddress = await this.upsertAddress(addresses, log.address);
          const token = await this.upsertToken(tokens, tokenAddress, "ERC1155");
          if (!token) continue;
          transfers.concat(ids.map((id, index) => new TransferModel({
            token,
            from: fromAddress,
            to: toAddress,
            txHash: tx.hash,
            logIndex: log.logIndex,
            tokenId: id.toString(),
            amount: values[index].toString()
          })));
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
          if (fromAddress.hash === zeroAddress) {
            updateBalance(toAddress, token, ids, values, true);
          }
          else if (toAddress.hash === zeroAddress) {
            updateBalance(fromAddress, token, ids, values, false);
          }
          else {
            updateBalance(fromAddress, token, ids, values, false);
            updateBalance(toAddress, token, ids, values, true);
          }
          upsertArray(addresses, fromAddress);
          upsertArray(addresses, toAddress);
          upsertArray(addresses, tokenAddress);
          upsertArray(tokens, token);
          logger.debug('from :>> ' + fromAddress);
          logger.debug('to :>> ' + toAddress);
          logger.debug('id :>> ' + ids);
          logger.debug('value :>> ' + values);
        }
      }
    }
    await AddressModel.bulkSave(addresses);
    await TokenModel.bulkSave(tokens);
    await TransferModel.insertMany(transfers);
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
