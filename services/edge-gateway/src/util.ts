import type { Context } from 'hono';
import { ERROR_CODES, type ErrorCode } from './protocol.js';

export function problem(c: Context, code: ErrorCode, message: string, details?: unknown, headers?: Record<string, string>): Response {
  const status = ERROR_CODES[code];
  const body = JSON.stringify({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
  return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(headers ?? {}) } });
}

/** Loi co kiem soat: nem trong ham xu ly, gateway doi thanh problem(). */
export class HttpProblem extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Chay tac vu nen: Workers dung waitUntil, Node chi can khong cho. */
export function defer(c: Context, p: Promise<unknown>): void {
  const safe = p.catch(() => undefined);
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    /* Node: khong co executionCtx; promise van chay */
  }
}

export function clientIp(c: Context): string {
  const h = c.req.raw.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() || 'unknown';
}

export function nowSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** So ngau nhien [0,1) co the thay trong test. */
export type Rng = () => number;
export const defaultRng: Rng = () => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0]! / 2 ** 32;
};

export function envInt(env: Record<string, string | undefined>, k: string, d: number): number {
  const v = env[k];
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
