STATUS: done
UPDATED: 2026-11-14T12:45Z

# p1-pricing

Thay don gia tam 20 d/luot bang engine gia that. Tai lieu: `docs/PRICING.md` (tieng Viet: mo hinh, vi du, cach dat bang gia dau tien, rao chan gia).

## Checklist
- [x] Migration 0007 (mot file, IF NOT EXISTS): `rate_cards` (customer x loai man x khu vuc x khung gio, per_impression|cpm, san, effective_from/to), `campaign_prices` (gia chot theo chien dich), `contract_line_prices`; backfill gia tam cho chien dich da duyet truoc 0007 (DB cu).
- [x] `packages/shared/src/pricing.ts`: ham thuan (daypart theo gio VN [17:00,22:00), CPM->luot bang ceil, chon dong cu the nhat, hieu luc theo ngay, san, hop dong ghi de, buildSnapshot/pickSnapshotPrice, BigInt estimate). So nguyen micro-VND.
- [x] API: chot gia luc duyet (cung giao dich), gui duyet/duyet tu choi 422 `no_rate_card` khi production chua co bang gia; `GET /campaigns/:id/quote`, `/pricing/quote` (khach thay gia, khong thay san/nguon); CRUD `/admin/v1/rate-cards` (finance:view xem, finance:approve ghi; audit rate_card.create/revise/end); `POST /admin/v1/contracts/:id/lines` (gia thoa thuan moi luot, finance:approve); chien dich gan contract_id.
- [x] Gateway: manifest record mang gia chot (server-side, khong vao JSON/etag), events.ts tinh `revenue_micro_vnd` = max(gia chot, san) theo khu vuc thiet bi + khung gio cua ts; khong co gia chot: du phong local/test, production `no_price`. Dem tran gio/PoP dedupe cua p5 khong dong cham.
- [x] Seed: bang gia mau CHI o demo seed (+ gia chot cho chien dich seed da duyet); bootstrap production rong (test seed-modes khang dinh).
- [x] Web: tab "Bang gia" (Finance), bao gia truoc khi gui o form tao chien dich va drawer chien dich.
- [x] Yeu cau tu p2: manifest bo ngu canh `lock` tru khi settings.tv_experience.lock_ads_enabled === true VA kid_safe; creative chi-lock bi loai; loai creative co creative_security.approved_version != content_version. Test contract (3 case).
- [x] Test: shared/pricing (13), api/p1-pricing (6), contract/pricing-e2e (5, gateway->spend->vi->reconcile), contract/protocol (+2 case manifest), web p1-pricing (2).
- [x] openapi generate (route cua p1 da them vao SRC). Test openapi con 1 that bai do route cua p3/p4 (billing/legal/ops) chua khai bao trong SRC cua build.ts: khong phai route cua p1.

## Ghi chu
- `finance:manage` khong ton tai trong RBAC (chi view/write/approve/delete): dung `finance:approve` (customer khong bao gio co).
- Don gia moi luot nam o `spend_events.amount_micro_vnd` (moi su kien mot dong) va tong lo o `spend_dedupe`; khong them cot vao bang cu (0007 khong ALTER).
- Chua kiem tra tren D1/Cloudflare that.
