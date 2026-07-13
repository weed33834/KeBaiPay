/**
 * OpenTelemetry SDK 初始化
 *
 * 必须在 NestFactory.create 之前 import，使 auto-instrumentation 能 patch
 * HTTP/Express/PG/ioredis 等模块的运行时方法，捕获分布式追踪 span。
 *
 * 启用方式：设置环境变量 OTEL_EXPORTER_OTLP_ENDPOINT（如 http://otel-collector:4318）
 * 未设置时 SDK 不启动，零开销（开发环境默认不启用）。
 *
 * 推荐后端：Jaeger / Tempo / Grafana Alloy / Honeygood / Datadog（兼容 OTLP）
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions'

let sdk: NodeSDK | undefined

export function startTracing(): void {
  if (sdk) return

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) {
    // 未配置 collector 端点时不启动，避免无谓的导出尝试
    return
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'kebaipay',
      [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
    }),
    instrumentations: [
      // auto-instrumentations 包含：http/https/express/pg/ioredis/dns/fs 等
      // disableFsInstrumentation 避免大量低价值 fs span 噪声
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  })

  sdk.start()

  // 优雅关闭：进程退出时 flush 残留 span，避免丢失尾部追踪数据
  const shutdown = async () => {
    try {
      await sdk?.shutdown()
    } catch {
      // 关闭失败不影响进程退出
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
