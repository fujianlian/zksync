part of 'package:zksync/credentials.dart';

const String MESSAGE =
    "Access zkSync account.\n\nOnly sign this message for a trusted client!";

class ZksSigner {
  String _privateKey;
  String _publicKey;
  ZksPubkeyHash _pubkeyHash;

  ZksSigner.from(Map<String, dynamic> data) {
    _privateKey = data['privateKey'];
    _publicKey = data['publicKey'];
    _pubkeyHash = ZksPubkeyHash.fromHex(data['pubKeyHash']);
  }

  static Future<ZksSigner> fromEthSigner(
      EthSigner ethereum, ChainId chainId) async {
    var message = MESSAGE;
    if (chainId != ChainId.Mainnet) {
      message = "$message\nChain ID: ${chainId.getChainId()}.";
    }
    final data = Utf8Encoder().convert(message);
    Uint8List signature = await ethereum.signPersonalMessage(data);
    final response = await ZkSyncJsBridge().getZksSigner(bytesToHex(signature));
    return ZksSigner.from(response);
  }

  String get publicKey => _publicKey;

  String get publicKeyHash => _pubkeyHash.hexHashPrefix;

  Future<SignedTransaction<T>> sign<T extends Transaction>(
      T transaction) async {
    final data = transaction.toBytes();
    final response =
        await ZkSyncJsBridge().getSignature(bytesToHex(data), _privateKey);
    var result = jsonDecode(response);
    if (!result['isSuccess']) {
      throw Exception(result['data']);
    }
    final signatureOb = Signature(this.publicKey, result['signature']);
    return SignedTransaction(transaction, signatureOb);
  }

  Future<Uint8List> signMessage(Uint8List payload) async {
    final response =
        await ZkSyncJsBridge().getSignature(bytesToHex(payload), _privateKey);
    var result = jsonDecode(response);
    if (!result['isSuccess']) {
      throw result['reason'];
    }
    return result['signature'];
  }
}
