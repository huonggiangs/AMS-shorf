import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STATES, CAMPAIGN_TRANSITIONS, InvalidTransitionError, assertTransition, canTransition, transitionCampaign, type CampaignState,
} from '../src/index.js';

describe('bang chuyen trang thai chien dich', () => {
  const valid = new Set<string>();
  for (const f of CAMPAIGN_STATES) for (const t of CAMPAIGN_TRANSITIONS[f]) valid.add(`${f}>${t}`);

  it('moi cap (from,to) khong co trong bang deu bi tu choi bang 409 invalid_state (khong ngoai le)', () => {
    let invalid = 0;
    for (const f of CAMPAIGN_STATES) {
      for (const t of CAMPAIGN_STATES) {
        if (valid.has(`${f}>${t}`)) {
          expect(canTransition(f, t)).toBe(true);
          expect(() => assertTransition(f, t)).not.toThrow();
        } else {
          invalid++;
          expect(canTransition(f, t), `${f}->${t}`).toBe(false);
          let err: unknown;
          try {
            assertTransition(f, t);
          } catch (e) {
            err = e;
          }
          expect(err, `${f}->${t}`).toBeInstanceOf(InvalidTransitionError);
          expect(err).toMatchObject({ status: 409, code: 'invalid_state', reason: 'not_allowed' });
        }
      }
    }
    expect(invalid).toBe(64 - valid.size); // 8x8 cap, gom ca tu chuyen (draft->draft)
    expect(invalid).toBeGreaterThan(30);
  });

  it('ended la trang thai cuoi; khong co tu chuyen; trang thai la bi tu choi', () => {
    expect(CAMPAIGN_TRANSITIONS.ended).toEqual([]);
    for (const s of CAMPAIGN_STATES) expect(canTransition(s, s)).toBe(false);
    expect(canTransition('active', 'bogus')).toBe(false);
    expect(canTransition('bogus', 'active')).toBe(false);
  });

  it('moi trang thai chi dat toi duoc tu duong hop le (khong cap nao dat duoc draft)', () => {
    for (const f of CAMPAIGN_STATES) expect(canTransition(f, 'draft')).toBe(false);
  });
});

describe('transitionCampaign (UPDATE co dieu kien)', () => {
  function fakeDb(changes: number) {
    const calls: { sql: string; params: unknown[] }[] = [];
    return { calls, run: async (sql: string, params: unknown[] = []) => (calls.push({ sql, params }), { changes }) };
  }
  it('cap khong hop le: nem truoc khi cham DB', async () => {
    const db = fakeDb(1);
    await expect(transitionCampaign(db, { id: 'c', from: 'ended', to: 'active', nowIso: 'x' })).rejects.toMatchObject({ status: 409, reason: 'not_allowed' });
    await expect(transitionCampaign(db, { id: 'c', from: ['active', 'draft'], to: 'paused', nowIso: 'x' })).rejects.toBeInstanceOf(InvalidTransitionError); // draft->paused sai
    expect(db.calls).toHaveLength(0);
  });
  it('sinh WHERE state IN (...) va tham so dung thu tu; 0 dong => stale 409', async () => {
    const db = fakeDb(1);
    await transitionCampaign(db, { id: 'c1', from: ['active', 'scheduled'], to: 'paused', nowIso: 'T', set: { reject_reason: null, approved_budget_vnd: { sql: 'budget_cap_vnd' } }, where: { sql: 'funding_state <> ?', params: ['x'] } });
    expect(db.calls[0]!.sql).toBe("UPDATE campaigns SET state = ?, updated_at = ?, reject_reason = ?, approved_budget_vnd = budget_cap_vnd WHERE id = ? AND state IN (?,?) AND (funding_state <> ?)");
    expect(db.calls[0]!.params).toEqual(['paused', 'T', null, 'c1', 'active', 'scheduled', 'x']);
    const lost = fakeDb(0);
    await expect(transitionCampaign(lost, { id: 'c1', from: 'active', to: 'paused', nowIso: 'T' })).rejects.toMatchObject({ status: 409, code: 'invalid_state', reason: 'stale' });
    // hang loat (khong id) khong nem
    expect(await transitionCampaign(lost, { from: 'scheduled', to: 'active', nowIso: 'T' })).toBe(0);
  });
  it('chan cot nguy hiem trong set', async () => {
    await expect(transitionCampaign(fakeDb(1), { id: 'c', from: 'draft', to: 'pending_review', nowIso: 'T', set: { 'name; DROP': 1 } })).rejects.toThrow();
    await expect(transitionCampaign(fakeDb(1), { id: 'c', from: 'draft', to: 'pending_review', nowIso: 'T', set: { state: 'x' } })).rejects.toThrow();
  });
  it('kieu: from la CampaignState', () => {
    const s: CampaignState = 'draft';
    expect(s).toBe('draft');
  });
});
