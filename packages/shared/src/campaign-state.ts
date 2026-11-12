// Co che trang thai chien dich: NGUON DUY NHAT. Moi doi `campaigns.state` (api, payments, job dinh ky) phai di qua `transitionCampaign`.
// Khong dung FOR UPDATE: moi chuyen trang thai la UPDATE co dieu kien `WHERE state IN (<from>)`; changes = 0 nghia la thua cuoc dua -> 409.

export const CAMPAIGN_STATES = ['draft', 'pending_review', 'awaiting_funds', 'scheduled', 'active', 'paused', 'rejected', 'ended'] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

/**
 * Bang chuyen trang thai hop le (from -> [to...]).
 *  - draft/rejected -> pending_review: gui duyet (rejected sua xong gui lai)
 *  - pending_review -> awaiting_funds: duyet (cho giu tien) | -> rejected: tra lai
 *  - awaiting_funds -> scheduled|active|paused: giu duoc tien (paused khi activate_on_approve = 0)
 *  - scheduled -> active: den ngay bat dau; active|scheduled|paused -> awaiting_funds: hoan tac kich hoat / tiep tuc khi chua giu tien
 *  - paused <-> active|scheduled: tam dung / tiep tuc
 *  - rejected: thu hoi duyet (ca khi da chay); ended: ket thuc (het han, het ngan sach, admin) — trang thai cuoi
 */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignState, readonly CampaignState[]>> = {
  draft: ['pending_review'],
  pending_review: ['awaiting_funds', 'rejected'],
  awaiting_funds: ['scheduled', 'active', 'paused', 'rejected', 'ended'],
  scheduled: ['active', 'paused', 'awaiting_funds', 'rejected', 'ended'],
  active: ['paused', 'awaiting_funds', 'rejected', 'ended'],
  paused: ['active', 'scheduled', 'awaiting_funds', 'rejected', 'ended'],
  rejected: ['pending_review'],
  ended: [],
};

/** Trang thai cho phep sua noi dung / xoa (khong phai chuyen trang thai). */
export const CAMPAIGN_EDITABLE_STATES: readonly CampaignState[] = ['draft', 'rejected'];
export const CAMPAIGN_DELETABLE_STATES: readonly CampaignState[] = ['draft', 'rejected', 'pending_review', 'awaiting_funds'];

export const isCampaignState = (s: unknown): s is CampaignState => typeof s === 'string' && (CAMPAIGN_STATES as readonly string[]).includes(s);

export function canTransition(from: string, to: string): boolean {
  return isCampaignState(from) && isCampaignState(to) && CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Loi chuyen trang thai: luon tuong ung HTTP 409 `invalid_state`. `reason`: 'not_allowed' (khong co trong bang) | 'stale' (thua cuoc dua / trang thai da doi). */
export class InvalidTransitionError extends Error {
  readonly code = 'invalid_state';
  readonly status = 409;
  constructor(
    public from: string | string[],
    public to: string,
    public reason: 'not_allowed' | 'stale',
    message?: string,
  ) {
    super(message ?? (reason === 'stale' ? `Chiến dịch vừa đổi trạng thái (mong đợi ${[from].flat().join('|')} -> ${to}), hãy tải lại.` : `Không thể chuyển chiến dịch từ ${[from].flat().join('|')} sang ${to}.`));
    this.name = 'InvalidTransitionError';
  }
}
export const isInvalidTransition = (e: unknown): e is InvalidTransitionError => e instanceof InvalidTransitionError;

/** Nem InvalidTransitionError (409) neu `from -> to` khong co trong bang. */
export function assertTransition(from: string, to: string, message?: string): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to, 'not_allowed', message);
}

/** Phan toi thieu cua Db ma helper can (tuong thich @ams/runtime Db va DbLike). */
export interface RunDb {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export interface TransitionOptions {
  /** chien dich dich; bo trong = hang loat theo `where` (vd. scheduled -> active khi den ngay) */
  id?: string;
  /** trang thai hien tai mong doi (mot hoac nhieu); moi cap from->to deu phai hop le trong bang */
  from: CampaignState | readonly CampaignState[];
  to: CampaignState;
  nowIso: string;
  /** cot khac cap nhat cung luc: gia tri thuong (tham so hoa) hoac { sql, params } cho bieu thuc nhu CASE/COALESCE */
  set?: Record<string, string | number | null | { sql: string; params?: unknown[] }>;
  /** dieu kien bo sung (SQL + tham so), vd. `funding_state <> 'reserved'` */
  where?: { sql: string; params?: unknown[] };
  /** thong bao 409 tuy chinh khi thua cuoc dua */
  staleMessage?: string;
  /** chap nhan 0 dong (dung cho job hang loat) */
  allowNone?: boolean;
}

const COL = /^[a-z_][a-z0-9_]*$/;

/**
 * Chuyen trang thai nguyen tu: `UPDATE campaigns SET state = to, ... WHERE [id = ?] AND state IN (from) [AND where]`.
 * Tra so dong. Co `id` ma 0 dong => InvalidTransitionError('stale') (409). Cap from->to khong hop le => 'not_allowed' (409), khong cham DB.
 */
export async function transitionCampaign(db: RunDb, o: TransitionOptions): Promise<number> {
  const froms = [o.from].flat() as CampaignState[];
  if (froms.length === 0) throw new Error('transitionCampaign: from rong');
  for (const f of froms) assertTransition(f, o.to);
  const sets: string[] = ['state = ?', 'updated_at = ?'];
  const params: unknown[] = [o.to, o.nowIso];
  for (const [col, v] of Object.entries(o.set ?? {})) {
    if (!COL.test(col) || col === 'state' || col === 'updated_at') throw new Error(`transitionCampaign: cot khong hop le: ${col}`);
    if (v !== null && typeof v === 'object') {
      sets.push(`${col} = ${v.sql}`);
      params.push(...(v.params ?? []));
    } else {
      sets.push(`${col} = ?`);
      params.push(v);
    }
  }
  const conds: string[] = [`state IN (${froms.map(() => '?').join(',')})`];
  const wparams: unknown[] = [...froms];
  if (o.id !== undefined) {
    conds.unshift('id = ?');
    wparams.unshift(o.id);
  }
  if (o.where) {
    conds.push(`(${o.where.sql})`);
    wparams.push(...(o.where.params ?? []));
  }
  const r = await db.run(`UPDATE campaigns SET ${sets.join(', ')} WHERE ${conds.join(' AND ')}`, [...params, ...wparams]);
  if (r.changes === 0 && o.id !== undefined && !o.allowNone) throw new InvalidTransitionError(o.from as CampaignState | CampaignState[], o.to, 'stale', o.staleMessage);
  return r.changes;
}
