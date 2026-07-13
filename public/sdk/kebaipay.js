/**
 * KeBaiPay Merchant Node.js SDK
 *
 * 安全警告：此 SDK 仅限商户后端（Node.js）使用，禁止在浏览器端使用。
 * appSecret 是商户密钥，一旦泄露可伪造任意 OpenAPI 请求（创建订单、退款、转账、查余额），
 * 相当于完全接管商户账户。浏览器端如需创建订单，应调用商户自己的后端接口，
 * 由后端使用本 SDK 调用 OpenAPI。
 *
 * 商户后端接入示例：
 *   const { KeBaiPay } = require('./kebaipay.js');
 *   const kb = new KeBaiPay({
 *     appId: 'your_app_id',
 *     appSecret: 'your_app_secret',  // 从环境变量读取，禁止硬编码
 *     baseUrl: 'https://your-kebaipay-domain.com'
 *   });
 *   const order = await kb.createOrder({
 *     merchantOrderNo: 'MO_001',
 *     amount: 100.00,
 *     subject: 'Test Product'
 *   });
 *
 * 浏览器端创建订单的正确流程：
 *   1. 浏览器请求商户自己的后端接口 /api/create-order
 *   2. 商户后端用本 SDK 调用 OpenAPI 创建订单
 *   3. 商户后端把 cashierUrl 返回给浏览器
 *   4. 浏览器跳转到 cashierUrl 完成支付
 */
'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const TIMESTAMP_WINDOW_MS = 2 * 60 * 1000;

class KeBaiPay {
  constructor(options) {
    if (!options || !options.appId || !options.appSecret) {
      throw new Error('KeBaiPay: appId and appSecret are required');
    }
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
  }

  // Node.js crypto 同步生成 HMAC-SHA256，避免浏览器端 Web Crypto 的异步与密钥暴露
  _sign(method, path, body, timestamp, nonce) {
    const message = method + '\n' + path + '\n' + body + '\n' + timestamp + '\n' + nonce + '\n' + this.appId;
    return crypto.createHmac('sha256', this.appSecret).update(message, 'utf8').digest('hex');
  }

  _nonce() {
    return crypto.randomBytes(16).toString('hex');
  }

  _request(method, path, body) {
    const timestamp = Date.now().toString();
    const nonce = this._nonce();
    const bodyStr = body ? JSON.stringify(body) : '';
    const signature = this._sign(method, path, bodyStr, timestamp, nonce);
    const url = new URL(this.baseUrl + path);
    const lib = url.protocol === 'https:' ? https : http;

    const attempt = (retryCount) => new Promise((resolve, reject) => {
      const opts = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'x-app-id': this.appId,
          'x-timestamp': timestamp,
          'x-nonce': nonce,
          'x-signature': signature,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: this.timeout,
      };

      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) {
            reject(new Error(`Invalid JSON response: ${data}`));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(parsed.message || 'API Error');
            err.code = parsed.code || res.statusCode;
            err.status = res.statusCode;
            err.data = parsed;
            // 4xx 业务错误不重试
            if (err.status >= 400 && err.status < 500) {
              reject(err);
              return;
            }
            // 5xx 继续走重试逻辑
            if (retryCount < this.maxRetries) {
              const delayMs = Math.pow(2, retryCount + 1) * 1000 + Math.floor(Math.random() * 500);
              setTimeout(() => attempt(retryCount + 1).then(resolve, reject), delayMs);
              return;
            }
            reject(err);
            return;
          }
          resolve(parsed);
        });
      });

      req.on('error', (err) => {
        // 网络错误指数退避重试
        if (retryCount < this.maxRetries) {
          const delayMs = Math.pow(2, retryCount + 1) * 1000 + Math.floor(Math.random() * 500);
          setTimeout(() => attempt(retryCount + 1).then(resolve, reject), delayMs);
          return;
        }
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        if (retryCount < this.maxRetries) {
          const delayMs = Math.pow(2, retryCount + 1) * 1000 + Math.floor(Math.random() * 500);
          setTimeout(() => attempt(retryCount + 1).then(resolve, reject), delayMs);
          return;
        }
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });

    return attempt(0);
  }

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
  createOrder(params) {
    return this._request('POST', '/open-api/v1/orders', params);
  }

  /**
   * 查询订单
   * @param {string} orderNo
   * @returns {Promise<Object>}
   */
  getOrder(orderNo) {
    return this._request('GET', '/open-api/v1/orders/' + encodeURIComponent(orderNo));
  }

  /**
   * 退款
   * @param {Object} params
   * @param {string} params.orderNo
   * @param {number} [params.amount] - 退款金额（元），不传全额
   * @param {string} [params.reason]
   * @param {string} [params.idempotencyKey]
   * @returns {Promise<Object>}
   */
  refund(params) {
    return this._request('POST', '/open-api/v1/refunds', params);
  }

  /**
   * 转账
   * @param {Object} params
   * @param {string} params.toUserId
   * @param {number} params.amount
   * @param {string} [params.remark]
   * @param {string} [params.idempotencyKey]
   * @returns {Promise<Object>}
   */
  transfer(params) {
    return this._request('POST', '/open-api/v1/transfers', params);
  }

  /**
   * 查询商户余额
   * @returns {Promise<Object>}
   */
  getBalance() {
    return this._request('GET', '/open-api/v1/balance');
  }
}

module.exports = { KeBaiPay };
