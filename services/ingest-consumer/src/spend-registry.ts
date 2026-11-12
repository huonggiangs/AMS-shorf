import type { SpendFn } from './consumer.js';

/**
 * Cho phep ben tai chinh (a2/mountFinance) gan SpendFn cho consumer o noi khong tu tay tao consumer
 * (Docker: node.ts; Cloudflare: worker.ts cua edge-gateway). Khong import @ams/payments tai day.
 */
let fn: SpendFn | undefined;
export function setSpendFn(f: SpendFn | undefined): void {
  fn = f;
}
export function getSpendFn(): SpendFn | undefined {
  return fn;
}
