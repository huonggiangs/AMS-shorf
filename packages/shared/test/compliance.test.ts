import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUNNING, adjustmentAmounts, anonymizedEmail, daysPastDue, einvoiceIdempotencyKey, einvoiceRetryDelaySec, exceedsCreditLimit, isRestrictedCategory,
  kycSubmissionProblems, legalDraftProblems, maskValue, parseDunningConfig, parseRetentionPolicy, pendingAcceptances, planDunning, retentionCutoff,
} from '../src/index.js';

describe('legal', () => {
  it('nhan ra ban nhap va cho trong', () => {
    expect(legalDraftProblems('> **BẢN NHÁP, CHƯA** x `[Tên pháp nhân]` y').length).toBe(2);
    expect(legalDraftProblems('Văn bản đã hoàn thiện.')).toEqual([]);
  });
  it('chi doi chap nhan van ban chua chap nhan', () => {
    const docs = [
      { id: 'a', kind: 'terms', version: '1', sha256: 'x', requires_acceptance: true },
      { id: 'b', kind: 'sla', version: '1', sha256: 'y', requires_acceptance: false },
      { id: 'c', kind: 'privacy', version: '2', sha256: 'z', requires_acceptance: true },
    ];
    expect(pendingAcceptances(docs, new Set(['a'])).map((d) => d.id)).toEqual(['c']);
  });
});

describe('kyc', () => {
  it('yeu cau giay phep nganh khi han che', () => {
    expect(isRestrictedCategory('alcohol')).toBe(true);
    expect(isRestrictedCategory('general')).toBe(false);
    expect(kycSubmissionProblems({ business_reg_no: '0100', legal_rep_name: 'A', docTypes: ['business_registration'], restricted: true })).toHaveLength(1);
    expect(kycSubmissionProblems({ business_reg_no: '', legal_rep_name: 'A', docTypes: [], restricted: false })).toHaveLength(2);
  });
});

describe('dunning', () => {
  it('parse cau hinh va ap gioi han', () => {
    const c = parseDunningConfig({ reminder_offsets_days: [7, 0, 7, 9999, 'x', -3], auto_pause_after_days: 99999, send_emails: false });
    expect(c.reminder_offsets_days).toEqual([-3, 0, 7]);
    expect(c.auto_pause_after_days).toBe(DEFAULT_DUNNING.auto_pause_after_days);
    expect(c.send_emails).toBe(false);
  });
  it('chi gui moc lon nhat chua gui va tu tam dung', () => {
    const cfg = { ...DEFAULT_DUNNING, reminder_offsets_days: [-3, 0, 3, 7], auto_pause_after_days: 10 };
    expect(daysPastDue('2026-11-01', '2026-11-08')).toBe(7);
    expect(planDunning({ due_date: '2026-11-01', remaining_vnd: 100 }, '2026-11-08', cfg, [-3, 0])).toMatchObject({ markOverdue: true, reminderOffset: 7, autoPause: false });
    expect(planDunning({ due_date: '2026-11-01', remaining_vnd: 100 }, '2026-11-08', cfg, [-3, 0, 3, 7]).reminderOffset).toBeNull();
    expect(planDunning({ due_date: '2026-11-01', remaining_vnd: 100 }, '2026-11-12', cfg, []).autoPause).toBe(true);
    expect(planDunning({ due_date: '2026-11-10', remaining_vnd: 100 }, '2026-11-08', cfg, [])).toMatchObject({ markOverdue: false, reminderOffset: -3 });
    expect(planDunning({ due_date: '2026-11-01', remaining_vnd: 0 }, '2026-11-30', cfg, []).markOverdue).toBe(false);
  });
  it('han muc cong no', () => {
    expect(exceedsCreditLimit(0, 0, 1)).toBe(true);
    expect(exceedsCreditLimit(1000, 600, 400)).toBe(false);
    expect(exceedsCreditLimit(1000, 600, 401)).toBe(true);
  });
});

describe('einvoice', () => {
  it('khoa idempotency on dinh va lui thu lai', () => {
    expect(einvoiceIdempotencyKey('i1', 'adjustment', 'r9')).toBe('ams:i1:adjustment:r9');
    expect(einvoiceRetryDelaySec(1)).toBe(60);
    expect(einvoiceRetryDelaySec(7)).toBeNull();
  });
  it('chung tu dieu chinh tach VAT va tong khop so hoan', () => {
    const a = adjustmentAmounts(1_100_000, 10);
    expect(a).toEqual({ amount_vnd: -1_000_000, vat_vnd: -100_000, total_vnd: -1_100_000 });
    const b = adjustmentAmounts(1_234_567, 8);
    expect(b.amount_vnd + b.vat_vnd).toBe(b.total_vnd);
  });
});

describe('retention + dsr', () => {
  it('chinh sach luu giu co nen toi thieu', () => {
    expect(parseRetentionPolicy({ ev_heartbeat_days: 3 }).ev_heartbeat_days).toBe(30);
    expect(parseRetentionPolicy({ ev_heartbeat_days: 0 }).ev_heartbeat_days).toBe(0);
    expect(parseRetentionPolicy({ ev_proof_of_play_days: 90 }).ev_proof_of_play_days).toBe(90);
    expect(retentionCutoff(new Date('2026-11-14T00:00:00Z'), 30)).toBe('2026-10-15T00:00:00.000Z');
    expect(retentionCutoff(new Date(), 0)).toBeNull();
  });
  it('an danh va che gia tri', () => {
    expect(anonymizedEmail('ABC')).toBe('anonymized+abc@invalid.example');
    expect(maskValue('0912345678')).toBe('09******78');
    expect(maskValue('')).toBe('');
  });
});
