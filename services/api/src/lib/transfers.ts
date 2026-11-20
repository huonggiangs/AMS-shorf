// Trang thai chuyen tep lon cua creative (bang creative_transfers, migration 0018): tai len tung phan (multipart) va nhap tu lien ket (Drive/Dropbox/URL).
import type { Db, Runtime } from '@ams/runtime';
import { writeAudit } from './audit.js';
import { MULTIPART_SESSION_MS } from './creative.js';

export interface TransferPart {
  n: number;
  etag: string;
  size: number;
}
export interface TransferRow {
  creative_id: string;
  kind: 'multipart' | 'import';
  status: string;
  upload_id: string | null;
  part_size: number | null;
  total_parts: number | null;
  parts: string;
  bytes_done: number | string;
  bytes_total: number | string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  updated_at: string;
}

export const partsOf = (raw: string | null | undefined): TransferPart[] => {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? (v as TransferPart[]).filter((p) => p && Number.isInteger(p.n) && typeof p.etag === 'string') : [];
  } catch {
    return [];
  }
};

export async function getTransfer(db: Pick<Db, 'query'>, creativeId: string): Promise<TransferRow | null> {
  return (await db.query<TransferRow>('SELECT * FROM creative_transfers WHERE creative_id = ?', [creativeId]))[0] ?? null;
}

/** Huy multipart dang mo (neu co): huy tren kho + doi trang thai. Khong nem loi (dung trong don dep/xoa). Tra true neu da huy mot phien. */
export async function abortOpenMultipart(rt: Runtime, creativeId: string, storageKey: string | null, status: 'aborted' | 'expired' | 'failed' = 'aborted', audit?: { actorId: string | null; ip: string; customerId: string | null; reason: string }): Promise<boolean> {
  try {
    const t = await getTransfer(rt.db, creativeId);
    // multipart tai len (open) hoac nhap tu lien ket dang chay/cho (co phien multipart tren kho)
    if (!t || !((t.kind === 'multipart' && t.status === 'open') || (t.kind === 'import' && (t.status === 'queued' || t.status === 'running') && t.upload_id))) return false;
    if (t.upload_id && storageKey) {
      try {
        await rt.objects.multipartAbort?.(storageKey, t.upload_id);
      } catch (e) {
        console.error('[media] huy multipart loi:', (e as Error).name);
      }
    }
    const nowIso = rt.clock.now().toISOString();
    return await rt.db.tx(async (db) => {
      const r = await db.run('UPDATE creative_transfers SET status = ?, updated_at = ? WHERE creative_id = ? AND status = ?', [status, nowIso, creativeId, t.status]);
      if (r.changes === 0) return false;
      if (audit) await writeAudit(db, { rt, ip: audit.ip, actorId: audit.actorId }, { action: `media.multipart_${status}`, objectType: 'creative', objectId: creativeId, customerId: audit.customerId, diff: { upload_id: t.upload_id, reason: audit.reason, parts: partsOf(t.parts).length } });
      return true;
    });
  } catch (e) {
    console.error('[media] don multipart loi:', (e as Error).name);
    return false;
  }
}

/**
 * Cron/outbox: phien multipart het han (> 3 gio ke tu khi tao tep) -> huy tren kho, danh dau 'expired', tep 'uploading' -> 'invalid' (khong de hang cho vo han).
 * Khong xoa tep da hoan tat. Idempotent.
 */
export async function sweepMultipart(rt: Runtime, limit = 20): Promise<number> {
  const cutoff = new Date(rt.clock.now().getTime() - MULTIPART_SESSION_MS).toISOString();
  const rows = await rt.db.query<{ id: string; customer_id: string; storage_key: string | null; state: string }>(
    `SELECT c.id, c.customer_id, c.storage_key, c.state FROM creative_transfers t JOIN creatives c ON c.id = t.creative_id
      WHERE t.kind = 'multipart' AND t.status = 'open' AND c.created_at < ? ORDER BY t.updated_at LIMIT ?`,
    [cutoff, limit],
  );
  let n = 0;
  for (const r of rows) {
    if (await abortOpenMultipart(rt, r.id, r.storage_key, 'expired', { actorId: null, ip: 'cron', customerId: r.customer_id, reason: 'phiên tải lên quá 3 giờ' })) {
      n++;
      await rt.db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'invalid' WHERE id = ? AND state = 'uploading'", ['Phiên tải lên đã hết hạn (quá 3 giờ). Hãy tải lại tệp.', r.id]);
    }
  }
  return n;
}

/** Tep 'uploading' qua han (do loi cu nhu 413, dong tab, mat mang) khong bao gio tu xong: sau 1 gio chuyen thanh "can chinh sua" voi ly do ro rang (phien multipart dang mo thi do sweepMultipart xu ly sau 3 gio). */
export const STALE_UPLOAD_MS = 3600_000;
export const STALE_UPLOAD_MSG = 'Tải lên không hoàn tất, hãy tải lại.';
export async function sweepStaleUploads(rt: Runtime, limit = 100): Promise<number> {
  const cutoff = new Date(rt.clock.now().getTime() - STALE_UPLOAD_MS).toISOString();
  const rows = await rt.db.query<{ id: string; customer_id: string; storage_key: string | null }>(
    `SELECT c.id, c.customer_id, c.storage_key FROM creatives c
      WHERE c.state = 'uploading' AND c.source = 'upload' AND c.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM creative_transfers t WHERE t.creative_id = c.id AND t.kind = 'multipart' AND t.status = 'open')
      ORDER BY c.created_at LIMIT ?`,
    [cutoff, limit],
  );
  let n = 0;
  for (const r of rows) {
    try {
      const done = await rt.db.tx(async (db) => {
        const u = await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'invalid' WHERE id = ? AND state = 'uploading'", [STALE_UPLOAD_MSG, r.id]);
        if (u.changes === 0) return false;
        await writeAudit(db, { rt, ip: 'cron', actorId: null }, { action: 'media.upload_stale', objectType: 'creative', objectId: r.id, customerId: r.customer_id, diff: { reason: 'quá 1 giờ chưa xác nhận tải lên' } });
        return true;
      });
      if (done) {
        n++;
        if (r.storage_key) {
          try { await rt.objects.delete?.(r.storage_key); } catch { /* ruot mo coi khong anh huong */ }
        }
      }
    } catch (e) {
      console.error('[media] don tep ket loi:', (e as Error).name);
    }
  }
  return n;
}

/** Doc luoi khi liet ke: chay don dep toi da 1 lan/60 giay (khong lam cham moi lan mo trang). Khong nem loi. */
export async function lazySweepStaleUploads(rt: Runtime): Promise<void> {
  try {
    if ((await rt.kv.incr('sweep:stale-uploads', 60)) === 1) await sweepStaleUploads(rt, 50);
  } catch {
    /* khong chan viec liet ke */
  }
}
