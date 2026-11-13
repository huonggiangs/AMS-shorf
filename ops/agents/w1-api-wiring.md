STATUS: done
UPDATED: 2026-11-13T00:58:00Z

# w1-api-wiring
## Da lam
1. force_password_change: `authenticate` (admin + portal + finance) tra 403 `password_change_required` neu co `settings.force_password_change:<id>`; `/auth/me`, `/auth/logout`, `/auth/change-password` (alias `/auth/password/change {current,new}`) van dung duoc. Doi mat khau: kiem mat khau cu, chinh sach >=12 ky tu hoa/thuong/so, khac cu, khong chua phan dau email; xoa co, huy phien khac, audit (`auth.password_changed|password_change_failed`), rate limit. Login va mfa/verify tra `must_change_password`. Web: Login.tsx buoc 'change', Profile.tsx form + canh bao.
2. media: confirm ghi outbox `media.uploaded {creative_id}` cung giao dich, handler day sang rt.queue cho media-worker. Cong quet (routes/creatives-scan.ts): clean = qua; unscanned/skipped chi khi setting `allow_unscanned_creatives` (mac dinh tat); pending/link chua tai/infected/failed = chan, ma loi rieng. Ap dung o media approve va campaign approve. Manifest (gateway, a3) chua loc -> requests.
3. reject/end/delete: hoan tien thanh outbox `campaign.release` cung giao dich voi doi trang thai; funding_state giu 'reserved' cho toi khi hoan xong; handler chi chay khi chien dich van rejected/ended (hoac xoa); delete co tien giu = release roi xoa trong outbox (202 neu cho); reconcileReleases cho D1.
## Ghi chu pham vi
Da sua ngoai danh sach so huu (can thiet de hoan thanh muc 3 va cong quet): services/api/src/routes/campaigns.ts (reject/end/delete/approve), services/api/test/helpers.ts + api.test.ts (cho phep seed 'skipped', danh dau clean), apps/web-admin/src/test/password-change.test.tsx (moi).
UPDATED: 2026-11-13T01:04:30Z
