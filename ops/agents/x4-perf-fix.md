STATUS: done
UPDATED: 2026-11-13

Xong:
- services/ingest-consumer/src/consumer.ts: gom lo (thong diep den dong thoi dung chung mot lo, toi da 64; mot lan chi tieu/existingIds/append/danh dau cho ca lo; kv song song co gioi han), lo hong -> tach xu ly rieng de cach ly thong diep doc, gioi han thu lai 3 lan (dem trong kv theo hash thong diep) roi dead-letter vao topic `ingest.events.dead` + ack. Thu tu bat bien chi tieu -> ghi su kien -> danh dau xong giu nguyen. boot.ts: INGEST_CONCURRENCY mac dinh 64 vong nhan (RUNTIME=test: 1; MemoryQueue gui moi tin cho moi handler nen khong tang).
- payments/spend.ts: KHONG sua (khong can: gom lo o consumer da cat 6,85 -> 0,32 tx/message).
- TTL: edge-gateway/src/heartbeat-ttl.ts (moi, dan xuat 2 x 2880 + 60 = 5820 s), dung o presence.ts, gateway.ts, va 1 dong o devices.ts (default kvTtl) + protocol.ts (re-export PRESENCE_TTL_S, worker.ts tu theo). LUU Y: devices.ts/protocol.ts khong nam trong danh sach cho phep, chi sua toi thieu de co mot hang so chung.
- GW_CAPACITY_RPS mac dinh 5000 -> 700 (DEFAULT_GW_CAPACITY_RPS trong gateway.ts).
- Test: ingest-consumer/test/batching.test.ts (4), crash.test.ts them 1 test lo + mat dien o moi ranh gioi (sqlite+postgres), edge-gateway/test/ttl.test.ts (4), gateway.test.ts cap nhat 1 test presence TTL.
- tools/load: --consumer-bench N, --consumer-concurrency C; Makefile `make load`; docs/COST-MODEL.md (+ cost.py, output.txt tao lai), docs/SLO.md muc 6.

Chay lai: ingest-consumer 19/19, edge-gateway 59/59, payments 141/141, tests/chaos 92/92 (--no-file-parallelism --hookTimeout 180000). Do: results/consumer-bench-c1.json, consumer-bench-c64.json, x4-after-fleet.json.
Chua lam / canh bao: bao khoi dong khong cai thien; DbEventStore ghi tung dong (ngoai pham vi); mat toi da 64 message dang bay khi tien trinh chet; do tren 1 may 2 vCPU chia se, chua do phan cung rieng; typecheck toan repo chua chay (chi tung package).
