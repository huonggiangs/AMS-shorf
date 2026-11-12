import { createSpendFn } from '@ams/payments';
import type { Runtime } from '@ams/runtime';
import type { SpendFn } from './consumer.js';

/**
 * SpendFn: mac dinh la chi tieu that cua @ams/payments (idempotent theo idempotencyKey, cong don phan du micro-VND, khong vuot phan giu).
 * `setSpendFn` van cho phep thay the (kiem thu / ben tai chinh khac).
 */
let fn: SpendFn | undefined;
export function setSpendFn(f: SpendFn | undefined): void {
  fn = f;
}
export function getSpendFn(): SpendFn | undefined {
  return fn;
}
/** SpendFn se dung cho `rt`: ham da gan neu co, nguoc lai chi tieu that cua payments. */
export function spendFnFor(rt: Runtime): SpendFn {
  return fn ?? createSpendFn(rt);
}
