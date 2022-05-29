import { utils, constants, BigNumber } from 'ethers';

import { rescueHashOrders } from './crypto';

// Max number of tokens for the current version, it is determined by the zkSync circuit implementation.
const MAX_NUMBER_OF_TOKENS = Math.pow(2, 31);
// Max number of accounts for the current version, it is determined by the zkSync circuit implementation.
const MAX_NUMBER_OF_ACCOUNTS = Math.pow(2, 24);

export const MIN_NFT_TOKEN_ID = 65536;
export const CURRENT_TX_VERSION = 1;

const AMOUNT_EXPONENT_BIT_WIDTH = 5;
const AMOUNT_MANTISSA_BIT_WIDTH = 35;
const FEE_EXPONENT_BIT_WIDTH = 5;
const FEE_MANTISSA_BIT_WIDTH = 11;

export function floatToInteger(
    floatBytes,
    expBits,
    mantissaBits,
    expBaseNumber
) {
    if (floatBytes.length * 8 !== mantissaBits + expBits) {
        throw new Error('Float unpacking, incorrect input length');
    }

    const bits = buffer2bitsBE(floatBytes).reverse();
    let exponent = BigNumber.from(0);
    let expPow2 = BigNumber.from(1);
    for (let i = 0; i < expBits; i++) {
        if (bits[i] === 1) {
            exponent = exponent.add(expPow2);
        }
        expPow2 = expPow2.mul(2);
    }
    exponent = BigNumber.from(expBaseNumber).pow(exponent);

    let mantissa = BigNumber.from(0);
    let mantissaPow2 = BigNumber.from(1);
    for (let i = expBits; i < expBits + mantissaBits; i++) {
        if (bits[i] === 1) {
            mantissa = mantissa.add(mantissaPow2);
        }
        mantissaPow2 = mantissaPow2.mul(2);
    }
    return exponent.mul(mantissa);
}

export function bitsIntoBytesInBEOrder(bits) {
    if (bits.length % 8 !== 0) {
        throw new Error('wrong number of bits to pack');
    }
    const nBytes = bits.length / 8;
    const resultBytes = new Uint8Array(nBytes);

    for (let byte = 0; byte < nBytes; ++byte) {
        let value = 0;
        if (bits[byte * 8] === 1) {
            value |= 0x80;
        }
        if (bits[byte * 8 + 1] === 1) {
            value |= 0x40;
        }
        if (bits[byte * 8 + 2] === 1) {
            value |= 0x20;
        }
        if (bits[byte * 8 + 3] === 1) {
            value |= 0x10;
        }
        if (bits[byte * 8 + 4] === 1) {
            value |= 0x08;
        }
        if (bits[byte * 8 + 5] === 1) {
            value |= 0x04;
        }
        if (bits[byte * 8 + 6] === 1) {
            value |= 0x02;
        }
        if (bits[byte * 8 + 7] === 1) {
            value |= 0x01;
        }

        resultBytes[byte] = value;
    }

    return resultBytes;
}

function numberToBits(integer, bits) {
    const result = [];
    for (let i = 0; i < bits; i++) {
        result.push(integer & 1);
        integer /= 2;
    }
    return result;
}

export function integerToFloat(integer, expBits, mantissaBits, expBase) {
    const maxExponentPower = BigNumber.from(2).pow(expBits).sub(1);
    const maxExponent = BigNumber.from(expBase).pow(maxExponentPower);
    const maxMantissa = BigNumber.from(2).pow(mantissaBits).sub(1);

    if (integer.gt(maxMantissa.mul(maxExponent))) {
        throw new Error('Integer is too big');
    }

    // The algortihm is as follows: calculate minimal exponent
    // such that integer <= max_mantissa * exponent_base ^ exponent,
    // then if this minimal exponent is 0 we can choose mantissa equals integer and exponent equals 0
    // else we need to check two variants:
    // 1) with that minimal exponent
    // 2) with that minimal exponent minus 1
    let exponent = 0;
    let exponentTemp = BigNumber.from(1);
    while (integer.gt(maxMantissa.mul(exponentTemp))) {
        exponentTemp = exponentTemp.mul(expBase);
        exponent += 1;
    }
    let mantissa = integer.div(exponentTemp);
    if (exponent !== 0) {
        const variant1 = exponentTemp.mul(mantissa);
        const variant2 = exponentTemp.div(expBase).mul(maxMantissa);
        const diff1 = integer.sub(variant1);
        const diff2 = integer.sub(variant2);
        if (diff2.lt(diff1)) {
            mantissa = maxMantissa;
            exponent -= 1;
        }
    }

    // encode into bits. First bits of mantissa in LE order
    const encoding = [];

    encoding.push(...numberToBits(exponent, expBits));
    const mantissaNumber = mantissa.toNumber();
    encoding.push(...numberToBits(mantissaNumber, mantissaBits));

    return bitsIntoBytesInBEOrder(encoding.reverse()).reverse();
}

export function integerToFloatUp(
    integer,
    expBits,
    mantissaBits,
    expBase
) {
    const maxExponentPower = BigNumber.from(2).pow(expBits).sub(1);
    const maxExponent = BigNumber.from(expBase).pow(maxExponentPower);
    const maxMantissa = BigNumber.from(2).pow(mantissaBits).sub(1);

    if (integer.gt(maxMantissa.mul(maxExponent))) {
        throw new Error('Integer is too big');
    }

    // The algortihm is as follows: calculate minimal exponent
    // such that integer <= max_mantissa * exponent_base ^ exponent,
    // then mantissa is calculated as integer divided by exponent_base ^ exponent and rounded up
    let exponent = 0;
    let exponentTemp = BigNumber.from(1);
    while (integer.gt(maxMantissa.mul(exponentTemp))) {
        exponentTemp = exponentTemp.mul(expBase);
        exponent += 1;
    }
    let mantissa = integer.div(exponentTemp);
    if (!integer.mod(exponentTemp).eq(BigNumber.from(0))) {
        mantissa = mantissa.add(1);
    }

    // encode into bits. First bits of mantissa in LE order
    const encoding = [];

    encoding.push(...numberToBits(exponent, expBits));
    const mantissaNumber = mantissa.toNumber();
    encoding.push(...numberToBits(mantissaNumber, mantissaBits));

    return bitsIntoBytesInBEOrder(encoding.reverse()).reverse();
}

export function reverseBits(buffer) {
    const reversed = buffer.reverse();
    reversed.map((b) => {
        // reverse bits in byte
        b = ((b & 0xf0) >> 4) | ((b & 0x0f) << 4);
        b = ((b & 0xcc) >> 2) | ((b & 0x33) << 2);
        b = ((b & 0xaa) >> 1) | ((b & 0x55) << 1);
        return b;
    });
    return reversed;
}

function packAmount(amount) {
    return reverseBits(integerToFloat(amount, AMOUNT_EXPONENT_BIT_WIDTH, AMOUNT_MANTISSA_BIT_WIDTH, 10));
}

function packAmountUp(amount) {
    return reverseBits(integerToFloatUp(amount, AMOUNT_EXPONENT_BIT_WIDTH, AMOUNT_MANTISSA_BIT_WIDTH, 10));
}

function packFee(amount) {
    return reverseBits(integerToFloat(amount, FEE_EXPONENT_BIT_WIDTH, FEE_MANTISSA_BIT_WIDTH, 10));
}

function packFeeUp(amount) {
    return reverseBits(integerToFloatUp(amount, FEE_EXPONENT_BIT_WIDTH, FEE_MANTISSA_BIT_WIDTH, 10));
}

export function packAmountChecked(amount) {
    if (closestPackableTransactionAmount(amount.toString()).toString() !== amount.toString()) {
        throw new Error('Transaction Amount is not packable');
    }
    return packAmount(amount);
}

export function packFeeChecked(amount) {
    if (closestPackableTransactionFee(amount.toString()).toString() !== amount.toString()) {
        throw new Error('Fee Amount is not packable');
    }
    return packFee(amount);
}

/**
 * packs and unpacks the amount, returning the closest packed value.
 * e.g 1000000003 => 1000000000
 * @param amount
 */
export function closestPackableTransactionAmount(amount) {
    const packedAmount = packAmount(BigNumber.from(amount));
    return floatToInteger(packedAmount, AMOUNT_EXPONENT_BIT_WIDTH, AMOUNT_MANTISSA_BIT_WIDTH, 10);
}

export function closestGreaterOrEqPackableTransactionAmount(amount) {
    const packedAmount = packAmountUp(BigNumber.from(amount));
    return floatToInteger(packedAmount, AMOUNT_EXPONENT_BIT_WIDTH, AMOUNT_MANTISSA_BIT_WIDTH, 10);
}

export function isTransactionAmountPackable(amount) {
    return closestPackableTransactionAmount(amount).eq(amount);
}

/**
 * packs and unpacks the amount, returning the closest packed value.
 * e.g 1000000003 => 1000000000
 * @param fee
 */
export function closestPackableTransactionFee(fee) {
    const packedFee = packFee(BigNumber.from(fee));
    return floatToInteger(packedFee, FEE_EXPONENT_BIT_WIDTH, FEE_MANTISSA_BIT_WIDTH, 10);
}

export function closestGreaterOrEqPackableTransactionFee(fee) {
    const packedFee = packFeeUp(BigNumber.from(fee));
    return floatToInteger(packedFee, FEE_EXPONENT_BIT_WIDTH, FEE_MANTISSA_BIT_WIDTH, 10);
}

export function isTransactionFeePackable(amount) {
    return closestPackableTransactionFee(amount).eq(amount);
}

// Check that this token could be an NFT.
// NFT is not represented in TokenSets, so we cannot check the availability of NFT in TokenSets
export function isNFT(token) {
    return typeof token === 'number' && token >= MIN_NFT_TOKEN_ID;
}

export function buffer2bitsBE(buff) {
    const res = new Array(buff.length * 8);
    for (let i = 0; i < buff.length; i++) {
        const b = buff[i];
        res[i * 8] = (b & 0x80) !== 0 ? 1 : 0;
        res[i * 8 + 1] = (b & 0x40) !== 0 ? 1 : 0;
        res[i * 8 + 2] = (b & 0x20) !== 0 ? 1 : 0;
        res[i * 8 + 3] = (b & 0x10) !== 0 ? 1 : 0;
        res[i * 8 + 4] = (b & 0x08) !== 0 ? 1 : 0;
        res[i * 8 + 5] = (b & 0x04) !== 0 ? 1 : 0;
        res[i * 8 + 6] = (b & 0x02) !== 0 ? 1 : 0;
        res[i * 8 + 7] = (b & 0x01) !== 0 ? 1 : 0;
    }
    return res;
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTokenETH(token) {
    return token === 'ETH' || token === constants.AddressZero;
}


export function getChangePubkeyMessage(
    pubKeyHash,
    nonce,
    accountId,
    batchHash
) {
    const msgBatchHash = batchHash == undefined ? new Uint8Array(32).fill(0) : utils.arrayify(batchHash);
    const msgNonce = serializeNonce(nonce);
    const msgAccId = serializeAccountId(accountId);
    const msgPubKeyHash = serializeAddress(pubKeyHash);
    return utils.concat([msgPubKeyHash, msgNonce, msgAccId, msgBatchHash]);
}

export function getChangePubkeyLegacyMessage(pubKeyHash, nonce, accountId) {
    const msgNonce = utils.hexlify(serializeNonce(nonce));
    const msgAccId = utils.hexlify(serializeAccountId(accountId));
    const msgPubKeyHash = utils.hexlify(serializeAddress(pubKeyHash)).substr(2);
    const message =
        `Register zkSync pubkey:\n\n` +
        `${msgPubKeyHash}\n` +
        `nonce: ${msgNonce}\n` +
        `account id: ${msgAccId}\n\n` +
        `Only sign this message for a trusted client!`;
    return utils.toUtf8Bytes(message);
}

export function getToggle2FAMessage(require2FA, timestamp, pubKeyHash) {
    let message;
    if (require2FA) {
        message =
            `By signing this message, you are opting into Two-factor Authentication protection by the zkSync Server.\n` +
            `Transactions now require signatures by both your L1 and L2 private key.\n` +
            `Timestamp: ${timestamp}`;
    } else {
        message =
            `You are opting out of Two-factor Authentication protection by the zkSync Server.\n` +
            `Transactions now only require signatures by your L2 private key.\n` +
            `BY SIGNING THIS MESSAGE, YOU ARE TRUSTING YOUR WALLET CLIENT TO KEEP YOUR L2 PRIVATE KEY SAFE!\n` +
            `Timestamp: ${timestamp}`;
    }

    if (pubKeyHash) {
        message += `\nPubKeyHash: ${pubKeyHash}`;
    }

    return utils.toUtf8Bytes(message);
}

export function getSignedBytesFromMessage(message, addPrefix) {
    let messageBytes = typeof message === 'string' ? utils.toUtf8Bytes(message) : utils.arrayify(message);
    if (addPrefix) {
        messageBytes = utils.concat([
            utils.toUtf8Bytes(`\x19Ethereum Signed Message:\n${messageBytes.length}`),
            messageBytes
        ]);
    }
    return messageBytes;
}

export async function getEthSignatureType(
    _provider,
    message,
    signature,
    address
) {
    const messageBytes = typeof message === 'string' ? utils.toUtf8Bytes(message) : utils.arrayify(message);

    const messageNoPrefix = getSignedBytesFromMessage(messageBytes, false);
    const messageWithPrefix = getSignedBytesFromMessage(messageBytes, true);

    const prefixedECDSASigner = utils.recoverAddress(utils.keccak256(messageWithPrefix), signature);
    if (prefixedECDSASigner.toLowerCase() === address.toLowerCase()) {
        return {
            verificationMethod: 'ECDSA',
            isSignedMsgPrefixed: true
        };
    }

    const notPrefixedMsgECDSASigner = utils.recoverAddress(utils.keccak256(messageNoPrefix), signature);
    if (notPrefixedMsgECDSASigner.toLowerCase() === address.toLowerCase()) {
        return {
            verificationMethod: 'ECDSA',
            isSignedMsgPrefixed: false
        };
    }

    var isSignedMsgPrefixed = null;
    // Sometimes an error is thrown if the signature is wrong
    try {
        isSignedMsgPrefixed = await verifyERC1271Signature(address, messageNoPrefix, signature, _provider);
    } catch {
        isSignedMsgPrefixed = false;
    }

    return {
        verificationMethod: 'ERC-1271',
        isSignedMsgPrefixed
    };
}

function removeAddressPrefix(address) {
    if (address.startsWith('0x')) return address.substr(2);

    if (address.startsWith('sync:')) return address.substr(5);

    throw new Error("ETH address must start with '0x' and PubKeyHash must start with 'sync:'");
}

export function serializeContentHash(contentHash) {
    const contentHashBytes = utils.arrayify(contentHash);
    if (contentHashBytes.length !== 32) {
        throw new Error('Content hash must be 32 bytes long');
    }

    return contentHashBytes;
}
// PubKeyHash or eth address
export function serializeAddress(address) {
    const prefixlessAddress = removeAddressPrefix(address);

    const addressBytes = utils.arrayify(`0x${prefixlessAddress}`);
    if (addressBytes.length !== 20) {
        throw new Error('Address must be 20 bytes long');
    }

    return addressBytes;
}

export function serializeAccountId(accountId) {
    if (accountId < 0) {
        throw new Error('Negative account id');
    }
    if (accountId >= MAX_NUMBER_OF_ACCOUNTS) {
        throw new Error('AccountId is too big');
    }
    return numberToBytesBE(accountId, 4);
}

export function serializeTokenId(tokenId) {
    if (tokenId < 0) {
        throw new Error('Negative tokenId');
    }
    if (tokenId >= MAX_NUMBER_OF_TOKENS) {
        throw new Error('TokenId is too big');
    }
    return numberToBytesBE(tokenId, 4);
}

export function serializeAmountPacked(amount) {
    return packAmountChecked(BigNumber.from(amount));
}

export function serializeAmountFull(amount) {
    const bnAmount = BigNumber.from(amount);
    return utils.zeroPad(utils.arrayify(bnAmount), 16);
}

export function serializeFeePacked(fee) {
    return packFeeChecked(BigNumber.from(fee));
}

export function serializeNonce(nonce) {
    if (nonce < 0) {
        throw new Error('Negative nonce');
    }
    return numberToBytesBE(nonce, 4);
}

export function serializeTimestamp(time) {
    if (time < 0) {
        throw new Error('Negative timestamp');
    }
    return utils.concat([new Uint8Array(4), numberToBytesBE(time, 4)]);
}

export function serializeOrder(order) {
    const type = new Uint8Array(['o'.charCodeAt(0)]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const accountId = serializeAccountId(order.accountId);
    const recipientBytes = serializeAddress(order.recipient);
    const nonceBytes = serializeNonce(order.nonce);
    const tokenSellId = serializeTokenId(order.tokenSell);
    const tokenBuyId = serializeTokenId(order.tokenBuy);
    const sellPriceBytes = BigNumber.from(order.ratio[0]).toHexString();
    const buyPriceBytes = BigNumber.from(order.ratio[1]).toHexString();
    const amountBytes = serializeAmountPacked(order.amount);
    const validFrom = serializeTimestamp(order.validFrom);
    const validUntil = serializeTimestamp(order.validUntil);
    return utils.concat([
        type,
        version,
        accountId,
        recipientBytes,
        nonceBytes,
        tokenSellId,
        tokenBuyId,
        utils.zeroPad(sellPriceBytes, 15),
        utils.zeroPad(buyPriceBytes, 15),
        amountBytes,
        validFrom,
        validUntil
    ]);
}

export async function serializeSwap(swap) {
    const type = new Uint8Array([255 - 11]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const submitterId = serializeAccountId(swap.submitterId);
    const submitterAddress = serializeAddress(swap.submitterAddress);
    const nonceBytes = serializeNonce(swap.nonce);
    const orderA = serializeOrder(swap.orders[0]);
    const orderB = serializeOrder(swap.orders[1]);
    const ordersHashed = await rescueHashOrders(utils.concat([orderA, orderB]));
    const tokenIdBytes = serializeTokenId(swap.feeToken);
    const feeBytes = serializeFeePacked(swap.fee);
    const amountABytes = serializeAmountPacked(swap.amounts[0]);
    const amountBBytes = serializeAmountPacked(swap.amounts[1]);
    return utils.concat([
        type,
        version,
        submitterId,
        submitterAddress,
        nonceBytes,
        ordersHashed,
        tokenIdBytes,
        feeBytes,
        amountABytes,
        amountBBytes
    ]);
}

export function serializeWithdraw(withdraw) {
    const type = new Uint8Array([255 - 3]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const accountId = serializeAccountId(withdraw.accountId);
    const accountBytes = serializeAddress(withdraw.from);
    const ethAddressBytes = serializeAddress(withdraw.to);
    const tokenIdBytes = serializeTokenId(withdraw.token);
    const amountBytes = serializeAmountFull(withdraw.amount);
    const feeBytes = serializeFeePacked(withdraw.fee);
    const nonceBytes = serializeNonce(withdraw.nonce);
    const validFrom = serializeTimestamp(withdraw.validFrom);
    const validUntil = serializeTimestamp(withdraw.validUntil);
    return utils.concat([
        type,
        version,
        accountId,
        accountBytes,
        ethAddressBytes,
        tokenIdBytes,
        amountBytes,
        feeBytes,
        nonceBytes,
        validFrom,
        validUntil
    ]);
}

export function serializeMintNFT(mintNFT) {
    const type = new Uint8Array([255 - 9]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const accountId = serializeAccountId(mintNFT.creatorId);
    const accountBytes = serializeAddress(mintNFT.creatorAddress);
    const contentHashBytes = serializeContentHash(mintNFT.contentHash);
    const recipientBytes = serializeAddress(mintNFT.recipient);
    const tokenIdBytes = serializeTokenId(mintNFT.feeToken);
    const feeBytes = serializeFeePacked(mintNFT.fee);
    const nonceBytes = serializeNonce(mintNFT.nonce);
    return utils.concat([
        type,
        version,
        accountId,
        accountBytes,
        contentHashBytes,
        recipientBytes,
        tokenIdBytes,
        feeBytes,
        nonceBytes
    ]);
}

export function serializeWithdrawNFT(withdrawNFT) {
    const type = new Uint8Array([255 - 10]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const accountId = serializeAccountId(withdrawNFT.accountId);
    const accountBytes = serializeAddress(withdrawNFT.from);
    const ethAddressBytes = serializeAddress(withdrawNFT.to);
    const tokenBytes = serializeTokenId(withdrawNFT.token);
    const tokenIdBytes = serializeTokenId(withdrawNFT.feeToken);
    const feeBytes = serializeFeePacked(withdrawNFT.fee);
    const nonceBytes = serializeNonce(withdrawNFT.nonce);
    const validFrom = serializeTimestamp(withdrawNFT.validFrom);
    const validUntil = serializeTimestamp(withdrawNFT.validUntil);
    return utils.concat([
        type,
        version,
        accountId,
        accountBytes,
        ethAddressBytes,
        tokenBytes,
        tokenIdBytes,
        feeBytes,
        nonceBytes,
        validFrom,
        validUntil
    ]);
}

export function serializeTransfer(transfer) {
    const type = new Uint8Array([255 - 5]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const accountId = serializeAccountId(transfer.accountId);
    const from = serializeAddress(transfer.from);
    const to = serializeAddress(transfer.to);
    const token = serializeTokenId(transfer.token);
    const amount = serializeAmountPacked(transfer.amount);
    const fee = serializeFeePacked(transfer.fee);
    const nonce = serializeNonce(transfer.nonce);
    const validFrom = serializeTimestamp(transfer.validFrom);
    const validUntil = serializeTimestamp(transfer.validUntil);
    return utils.concat([type, version, accountId, from, to, token, amount, fee, nonce, validFrom, validUntil]);
}

export function serializeChangePubKey(changePubKey) {
    const type = new Uint8Array([255 - 7]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const accountIdBytes = serializeAccountId(changePubKey.accountId);
    const accountBytes = serializeAddress(changePubKey.account);
    const pubKeyHashBytes = serializeAddress(changePubKey.newPkHash);
    const tokenIdBytes = serializeTokenId(changePubKey.feeToken);
    const feeBytes = serializeFeePacked(changePubKey.fee);
    const nonceBytes = serializeNonce(changePubKey.nonce);
    const validFrom = serializeTimestamp(changePubKey.validFrom);
    const validUntil = serializeTimestamp(changePubKey.validUntil);
    return utils.concat([
        type,
        version,
        accountIdBytes,
        accountBytes,
        pubKeyHashBytes,
        tokenIdBytes,
        feeBytes,
        nonceBytes,
        validFrom,
        validUntil
    ]);
}

export function serializeForcedExit(forcedExit) {
    const type = new Uint8Array([255 - 8]);
    const version = new Uint8Array([CURRENT_TX_VERSION]);
    const initiatorAccountIdBytes = serializeAccountId(forcedExit.initiatorAccountId);
    const targetBytes = serializeAddress(forcedExit.target);
    const tokenIdBytes = serializeTokenId(forcedExit.token);
    const feeBytes = serializeFeePacked(forcedExit.fee);
    const nonceBytes = serializeNonce(forcedExit.nonce);
    const validFrom = serializeTimestamp(forcedExit.validFrom);
    const validUntil = serializeTimestamp(forcedExit.validUntil);
    return utils.concat([
        type,
        version,
        initiatorAccountIdBytes,
        targetBytes,
        tokenIdBytes,
        feeBytes,
        nonceBytes,
        validFrom,
        validUntil
    ]);
}

/**
 * Encodes the transaction data as the byte sequence according to the zkSync protocol.
 * @param tx A transaction to serialize.
 */
export async function serializeTx(
    tx
) {
    switch (tx.type) {
        case 'Transfer':
            return serializeTransfer(tx);
        case 'Withdraw':
            return serializeWithdraw(tx);
        case 'ChangePubKey':
            return serializeChangePubKey(tx);
        case 'ForcedExit':
            return serializeForcedExit(tx);
        case 'MintNFT':
            return serializeMintNFT(tx);
        case 'WithdrawNFT':
            return serializeWithdrawNFT(tx);
        case 'Swap':
            // this returns a promise
            return serializeSwap(tx);
        default:
            return new Uint8Array();
    }
}

export function numberToBytesBE(number, bytes) {
    const result = new Uint8Array(bytes);
    for (let i = bytes - 1; i >= 0; i--) {
        result[i] = number & 0xff;
        number >>= 8;
    }
    return result;
}

export function parseHexWithPrefix(str) {
    return Uint8Array.from(Buffer.from(str.slice(2), 'hex'));
}



export async function getTxHash(
    tx
) {
    if (tx.type == 'Close') {
        throw new Error('Close operation is disabled');
    }
    let txBytes = await serializeTx(tx);
    return utils.sha256(txBytes).replace('0x', 'sync-tx:');
}
