import { utils } from "ethers"
import uts46 from "idna-uts46-hx"
import { privateKeyFromSeed, privateKeyToPubKey, privateKeyToPubKeyHash, signTransactionBytes } from "./crypto"
import { serializeTx } from "./utils"

function encodeFunctionData(funcABI, func, params) {
    let ABI = JSON.parse(funcABI)
    let iface = new utils.Interface(ABI)
    let funcParams = JSON.parse(params)
    let result = iface.encodeFunctionData(func, funcParams)
    return result
}

function normalize(name) {
    return name ? uts46.toUnicode(name, { useStd3ASCII: true, transitional: false }) : name
}

async function getSignature(data, signature) {
    try {
        var transfer = JSON.parse(data)
        var msgBytes = await serializeTx(transfer)
        var seed = utils.arrayify(signature)
        var privateBytes = await privateKeyFromSeed(seed)
        var result = await signTransactionBytes(privateBytes, msgBytes)
        result.isSuccess = true
        return JSON.stringify(result)
    } catch (e) {
        return JSON.stringify({ isSuccess: false, reason: e.toString() })
    }
}

async function getPubKey(signature) {
    try {
        var seed = utils.arrayify(signature);
        var privateBytes = await privateKeyFromSeed(seed)
        var pubKeyHash = await privateKeyToPubKeyHash(privateBytes)
        return JSON.stringify({ isSuccess: true, data: pubKeyHash.substring(5) })
    } catch (e) {
        return JSON.stringify({ isSuccess: false, reason: e.toString() })
    }
}

async function getZksSigner(signature) {
    try {
        var seed = utils.arrayify(signature);
        var privateKey = await privateKeyFromSeed(seed)
        var publicKey = await privateKeyToPubKey(privateBytes)
        var pubKeyHash = await privateKeyToPubKeyHash(privateBytes)
        return JSON.stringify({ isSuccess: true, privateKey, publicKey, pubKeyHash:pubKeyHash.substring(5) })
    } catch (e) {
        return JSON.stringify({ isSuccess: false, reason: e.toString() })
    }
}

window.encodeFunctionData = encodeFunctionData
window.normalize = normalize
window.getSignature = getSignature
window.getPubKey = getPubKey
window.getZksSigner = getZksSigner