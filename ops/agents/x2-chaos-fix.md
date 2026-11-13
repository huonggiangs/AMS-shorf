# x2-chaos-fix

## Da sua
1. **Gateway manifest** (`services/edge-gateway/src/manifest.ts`)
   - `kv.get/set` loi tren `creative:sha256:*` / `creative:rendition:*` = cache miss (tinh lai tu objects), khong go creative.
   - Loi tam thoi cua `objects.get` (sha256/rendition) danh dau ban xay la SUY GIAM: khong ghi kv, co ban cu thi dung ban cu, khong co thi nem loi (5xx, thiet bi giu manifest dang co). Khong con manifest rong/thieu bi cache. Rendition 'none' chi cache khi objects TRA null that (khong cache khi loi).
   - `allowUnscanned()` khong nuot loi DB nua (truoc: false => go moi creative chua quet). Loi DB luc xay => dung ban cu / 5xx.
2. **Payments** (`activation.ts`, `ledger.ts`)
   - `creditTopup` nhanh 'already' voi topup `credited` goi `healActivation` (runActivation idempotent + bump epoch): webhook gui lai/confirm lai sau khi vi da cong nhung kich hoat chua chay se hoi tu.
   - `sweepActivations(rt)` moi: khach co awaiting_funds du tien kha dung, hoac pending_payment co topup credited => runActivation. Idempotent.
   - R1-05: thu chao di qua outbox (topic `mail.send`, enqueue CUNG tx, dedupe theo invite id), gui best-effort sau commit (`drainMailOutbox`), loi SMTP khong chan kich hoat; thu lai qua outbox.
3. `docs/DEVICE-PROTOCOL.md` 6.1: `unknown` la mang id (xac nhan o `commands.ts ackCommands`).

## Test
- tests/chaos: 2 it.fails -> it() (events: kv sha256; payments: webhook + kich hoat k=1..W); bo SKIP `creative:` khoi cac kich ban ngau nhien (6 kich ban x seed deu xanh voi loi kv tren creative:*).
- Them: kv set/get rendition loi; objects tam thoi loi khong cache + phuc hoi; SMTP hong -> 200 + active + mail gui dung 1 lan sau khi phuc hoi; sweeper; heal-on-retry. sqlite (postgres: CHAOS_DIALECTS=sqlite,postgres).
- Xanh: chaos 92, contract 38, edge-gateway 55, payments 135; tsc payments + edge-gateway sach.

## Yeu cau cho chu file khac (khong sua duoc)
- w1 `services/api/src/outbox.ts`: gop `mailOutboxHandlers()` (`@ams/payments`) vao `createOutboxHandlers` de mail.send duoc thu lai theo lich (hien chi co lan gui ngay sau commit).
- s1/`jobs.ts` (`runFrequentFinanceJobs`) hoac scheduled(): goi `sweepActivations(rt)` cung nhip 10 phut.
- Luu y: payload outbox `mail.send` chua link moi (token) dang ro; `pruneOutbox` xoa sau 14 ngay, token het han 72h.
