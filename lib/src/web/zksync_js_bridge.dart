part of 'package:zksync/zksync.dart';

class ZkSyncJsBridge {
  static const String web3_eth_abi_lib_path = "package/zksync/lib/src/web/jslib/dist/main.js";

  FlutterWebviewPlugin _webviewPlugin;

  final webviewPlugin = Completer<FlutterWebviewPlugin>();

  static ZkSyncJsBridge _bridge;

  static ZkSyncJsBridge get bridge => _bridge ?? ZkSyncJsBridge();

  Map<String, Function> _msgHandlers = {};
  Map<String, Completer> _msgCompleters = {};
  int _evalJavascriptUID = 10000;

  int get _getEvalJavascriptUID => _evalJavascriptUID++;

  factory ZkSyncJsBridge() {
    if (_bridge == null) {
      _bridge = ZkSyncJsBridge._();
    }
    return _bridge;
  }

  ZkSyncJsBridge._() {
    _webviewPlugin = FlutterWebviewPlugin();
    webviewPlugin.complete(_webviewPlugin);
    _webviewPlugin.onStateChanged.listen((state) async {
      if (state.type == WebViewState.shouldStart) {
        debugPrint('Common Js Bridge load state ${state.type}');
        String jsCode = await rootBundle.loadString(web3_eth_abi_lib_path);
        await _webviewPlugin.evalJavascript(jsCode);
      }
    });

    _webviewPlugin.launch('about:blank',
        javascriptChannels: [
          JavascriptChannel(
              name: 'ZkSyncBridge',
              onMessageReceived: (JavascriptMessage message) {
                debugPrint('received msg: ${message.message}');
                compute(jsonDecode, message.message).then((msg) {
                  final String path = msg['path'];
                  if (_msgCompleters[path] != null) {
                    Completer handler = _msgCompleters[path];
                    handler.complete(msg['data']);
                    if (path.contains('uid=')) {
                      _msgCompleters.remove(path);
                    }
                  }
                  // 订阅消息
                  if (_msgHandlers[path] != null) {
                    Function handler = _msgHandlers[path];
                    handler(msg['data']);
                  }
                });
              }),
        ].toSet(),
        ignoreSSLErrors: true,
        hidden: true);
  }

  /// 执行 JavaScript 代码
  /// keepConnected: 是否要求已经连接到节点
  Future<dynamic> evalJavascript(String code,
      {bool keepConnected = true}) async {
    // 检查请求是否重复发送
    for (String key in _msgCompleters.keys) {
      String call = code.split('(')[0];
      if (key.contains(call)) {
        debugPrint('request $call is loading');
        return _msgCompleters[key]?.future;
      }
    }

    final completer = new Completer();

    String method = 'uid=$_getEvalJavascriptUID;${code.split('(')[0]}';
    _msgCompleters[method] = completer;

    String script =
        '$code.then((res) => {ZkSyncBridge.postMessage(JSON.stringify({ ' +
            'path: "$method", data: res }));}).catch((err) => ' +
            '{ZkSyncBridge.postMessage(JSON.stringify({ path: "log", data: err }));});';
    String scriptWithCatch =
        'try{$script}catch(e){ZkSyncBridge.postMessage(JSON.stringify({ path: "$method", data: e }));}';
    _webviewPlugin.evalJavascript(scriptWithCatch);

    return completer.future;
  }

  Future<dynamic> call(String api, [dynamic parameters]) async {
    if (parameters != null) {
      if (parameters is Iterable) {
        if (parameters.length > 1) {
          parameters = parameters.reduce((x, y) => "\"$x\",\"$y\"");
        } else {
          parameters = "\"${parameters.first}\"";
        }
      } else {
        parameters = "\"$parameters\"";
      }

      print('calling: $api($parameters)');
      return evalJavascript('$api($parameters)');
    } else {
      return evalJavascript('$api()');
    }
  }

  Future<String> getSignature(String data, String signature) async {
    String code = 'getSignature(\'$data\',\'$signature\')';
    String result = await evalJavascript(code) ?? '';
    return result;
  }

  Future<String> getPubKey(String signature) async {
    String code = 'getPubKey(\'$signature\')';
    String result = await evalJavascript(code) ?? '';
    return result;
  }

  Future<Map<String, dynamic>> getZksSigner(String signature) async {
    String code = 'getZksSigner(\'$signature\')';
    final response = await evalJavascript(code) ?? '';
    var result = jsonDecode(response);
    if (!result['isSuccess']) {
      throw Exception(result['reason']);
    }
    return result;
  }
}
