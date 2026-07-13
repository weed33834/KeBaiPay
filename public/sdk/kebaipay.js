/**
 * KeBaiPay Merchant JS SDK
 *
 * 商户接入示例：
 * <script src="https://your-kebaipay-domain.com/sdk/kebaipay.js"></script>
 * <script>
 *   const kb = new KeBaiPay({
 *     appId: 'your_app_id',
 *     appSecret: 'your_app_secret',
 *     baseUrl: 'https://your-kebaipay-domain.com'
 *   });
 *
 *   const order = await kb.createOrder({
 *     merchantOrderNo: 'MO_001',
 *     amount: 100.00,
 *     subject: 'Test Product'
 *   });
 *   window.location.href = order.cashierUrl;
 * </script>
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KeBaiPay = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 30000;
  var DEFAULT_MAX_RETRIES = 3;
  var TIMESTAMP_WINDOW_MS = 2 * 60 * 1000;

  function KeBaiPay(options) {
    if (!options || !options.appId || !options.appSecret) {
      throw new Error('KeBaiPay: appId and appSecret are required');
    }
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
  }

  /**
   * 使用 Web Crypto API 生成真实 HMAC-SHA256 签名（异步）
   * 浏览器需支持 crypto.subtle（HTTPS 或 localhost 环境）
   */
  KeBaiPay.prototype._sign = function (method, path, body, timestamp, nonce) {
    var message = method + '\n' + path + '\n' + body + '\n' + timestamp + '\n' + nonce + '\n' + this.appId;
    return this._hmacSha256(message);
  };

  KeBaiPay.prototype._hmacSha256 = function (message) {
    var encoder = new TextEncoder();
    var keyBytes = encoder.encode(this.appSecret);
    var dataBytes = encoder.encode(message);
    // crypto.subtle 仅在 HTTPS 或 localhost 下可用
    return crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ).then(function (key) {
      return crypto.subtle.sign('HMAC', key, dataBytes);
    }).then(function (sigBuf) {
      return _bufferToHex(new Uint8Array(sigBuf));
    });
  };

  /**
   * 生成随机 nonce（密码学安全）
   */
  KeBaiPay.prototype._nonce = function () {
    var array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  };

  /**
   * 发起 API 请求，含超时与指数退避重试
   * 仅对网络错误/5xx 重试，4xx 不重试
   */
  KeBaiPay.prototype._request = function (method, path, body) {
    var self = this;
    // 时间戳为毫秒，与服务端 open-api.guard.ts 的 TIMESTAMP_WINDOW_MS 对齐
    var timestamp = Date.now().toString();
    var nonce = self._nonce();
    var bodyStr = body ? JSON.stringify(body) : '';

    return self._sign(method, path, bodyStr, timestamp, nonce).then(function (signature) {
      var url = self.baseUrl + path;
      var attempt = 0;

      function doAttempt() {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, self.timeout);
        var opts = {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'x-app-id': self.appId,
            'x-timestamp': timestamp,
            'x-nonce': nonce,
            'x-signature': signature
          },
          signal: controller.signal
        };
        if (body) opts.body = bodyStr;

        return fetch(url, opts).then(function (res) {
          clearTimeout(timer);
          return res.json().then(function (data) {
            if (!res.ok) {
              var err = new Error(data.message || 'API Error');
              err.code = data.code || res.status;
              err.status = res.status;
              err.data = data;
              throw err;
            }
            return data;
          });
        }).catch(function (err) {
          clearTimeout(timer);
          // 4xx 业务错误不重试，直接抛出
          if (err.status && err.status >= 400 && err.status < 500) throw err;
          // 网络错误/5xx 指数退避重试
          if (attempt < self.maxRetries) {
            attempt++;
            var delayMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
            return new Promise(function (resolve) { setTimeout(resolve, delayMs); }).then(doAttempt);
          }
          throw err;
        });
      }

      return doAttempt();
    });
  };

  /**
   * 创建支付订单
   * @param {Object} params
   * @param {string} params.merchantOrderNo - 商户订单号
   * @param {number} params.amount - 金额（元）
   * @param {string} params.subject - 商品标题
   * @param {string} [params.body] - 商品描述
   * @param {string} [params.callbackUrl] - 支付回调地址
   * @param {string} [params.expiredAt] - 过期时间 YYYY-MM-DD HH:mm:ss
   * @param {string} [params.idempotencyKey] - 幂等键
   * @returns {Promise<Object>} 含 cashierUrl
   */
  KeBaiPay.prototype.createOrder = function (params) {
    return this._request('POST', '/open-api/v1/orders', params);
  };

  /**
   * 查询订单
   * @param {string} orderNo
   * @returns {Promise<Object>}
   */
  KeBaiPay.prototype.getOrder = function (orderNo) {
    return this._request('GET', '/open-api/v1/orders/' + encodeURIComponent(orderNo));
  };

  /**
   * 退款
   * @param {Object} params
   * @param {string} params.orderNo
   * @param {number} [params.amount] - 退款金额（元），不传全额
   * @param {string} [params.reason]
   * @param {string} [params.idempotencyKey]
   * @returns {Promise<Object>}
   */
  KeBaiPay.prototype.refund = function (params) {
    return this._request('POST', '/open-api/v1/refunds', params);
  };

  /**
   * 转账
   * @param {Object} params
   * @param {string} params.toUserId
   * @param {number} params.amount
   * @param {string} [params.remark]
   * @param {string} [params.idempotencyKey]
   * @returns {Promise<Object>}
   */
  KeBaiPay.prototype.transfer = function (params) {
    return this._request('POST', '/open-api/v1/transfers', params);
  };

  /**
   * 查询商户余额
   * @returns {Promise<Object>}
   */
  KeBaiPay.prototype.getBalance = function () {
    return this._request('GET', '/open-api/v1/balance');
  };

  function _bufferToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  return KeBaiPay;
}));
