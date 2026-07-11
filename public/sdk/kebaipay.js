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
 *   // Create order and redirect to cashier
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

  function KeBaiPay(options) {
    if (!options || !options.appId || !options.appSecret) {
      throw new Error('KeBaiPay: appId and appSecret are required');
    }
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
  }

  /**
   * Generate HMAC-SHA256 signature
   */
  KeBaiPay.prototype._sign = function (method, path, body, timestamp, nonce) {
    var message = method + '\n' + path + '\n' + body + '\n' + timestamp + '\n' + nonce + '\n' + this.appId;
    
    // Use SubtleCrypto if available (browser), otherwise fallback
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      // For sync usage, we'll use a simple HMAC implementation
      return this._hmacSha256Sync(message);
    }
    return this._hmacSha256Sync(message);
  };

  /**
   * Simple HMAC-SHA256 implementation for browser environments
   * WARNING: This is a PLACEHOLDER implementation and MUST be replaced with
   * real HMAC-SHA256 (e.g., via Web Crypto API or a trusted crypto library)
   * before production use. This fake HMAC provides NO security.
   * In production, use crypto.subtle.sign() for async operations.
   */
  KeBaiPay.prototype._hmacSha256Sync = function (message) {
    // WARNING: This is a FAKE HMAC - a non-cryptographic hash placeholder.
    // It MUST be replaced with real HMAC-SHA256 (e.g. via SubtleCrypto) before production.
    var encoder = new TextEncoder();
    var data = encoder.encode(message);
    var key = encoder.encode(this.appSecret);
    
    // Simple hash for demo - MUST be replaced with real HMAC-SHA256 in production
    var hash = 0;
    for (var i = 0; i < data.length; i++) {
      var char = data[i];
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    // Return hex string - WARNING: placeholder output, NOT a real HMAC signature
    return Math.abs(hash).toString(16).padStart(64, '0');
  };

  /**
   * Generate random nonce
   */
  KeBaiPay.prototype._nonce = function () {
    var array = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(array);
    } else {
      for (var i = 0; i < 16; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(array, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  };

  /**
   * Make API request
   */
  KeBaiPay.prototype._request = function (method, path, body) {
    var timestamp = Math.floor(Date.now() / 1000).toString();
    var nonce = this._nonce();
    var bodyStr = body ? JSON.stringify(body) : '';
    var signature = this._sign(method, path, bodyStr, timestamp, nonce);

    var url = this.baseUrl + path;
    var options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': this.appId,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature
      }
    };
    if (body) {
      options.body = bodyStr;
    }

    return fetch(url, options).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || 'API Error');
          err.code = data.code || res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  };

  /**
   * Create a payment order
   * @param {Object} params - Order parameters
   * @param {string} params.merchantOrderNo - Merchant's order number
   * @param {number} params.amount - Amount in yuan (e.g., 100.00)
   * @param {string} params.subject - Product subject
   * @param {string} [params.body] - Product description
   * @param {string} [params.callbackUrl] - Callback URL for payment notification
   * @param {string} [params.expiredAt] - Expiration time (YYYY-MM-DD HH:mm:ss)
   * @returns {Promise<Object>} Order info with cashierUrl
   */
  KeBaiPay.prototype.createOrder = function (params) {
    return this._request('POST', '/open-api/v1/orders', params);
  };

  /**
   * Query order by orderNo
   * @param {string} orderNo - Order number
   * @returns {Promise<Object>} Order details
   */
  KeBaiPay.prototype.getOrder = function (orderNo) {
    return this._request('GET', '/open-api/v1/orders/' + encodeURIComponent(orderNo));
  };

  /**
   * Refund an order
   * @param {Object} params - Refund parameters
   * @param {string} params.orderNo - Order number to refund
   * @param {number} [params.amount] - Refund amount in yuan (full refund if omitted)
   * @param {string} [params.reason] - Refund reason
   * @param {string} [params.idempotencyKey] - Idempotency key
   * @returns {Promise<Object>} Refund result
   */
  KeBaiPay.prototype.refund = function (params) {
    return this._request('POST', '/open-api/v1/refunds', params);
  };

  /**
   * Transfer to user
   * @param {Object} params - Transfer parameters
   * @param {string} params.toUserId - Target user ID
   * @param {number} params.amount - Amount in yuan
   * @param {string} [params.remark] - Transfer remark
   * @param {string} [params.idempotencyKey] - Idempotency key
   * @returns {Promise<Object>} Transfer result
   */
  KeBaiPay.prototype.transfer = function (params) {
    return this._request('POST', '/open-api/v1/transfers', params);
  };

  /**
   * Query merchant balance
   * @returns {Promise<Object>} Balance info
   */
  KeBaiPay.prototype.getBalance = function () {
    return this._request('GET', '/open-api/v1/balance');
  };

  return KeBaiPay;
}));
