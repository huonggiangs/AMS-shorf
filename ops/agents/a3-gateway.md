STATUS: done
UPDATED: 07:12 UTC

- Xong: edge-gateway (gateway.ts, worker.ts+DO PresenceShard, node.ts), ingest-consumer, tools/sim (VirtualDevice, loadtest), docs/DEVICE-PROTOCOL.md.
- Kiem chung: pnpm --filter @ams/edge-gateway test (29), @ams/ingest-consumer (5), @ams/sim (8, gom 2.000 thiet bi ao). Typecheck 3 goi + tsconfig.workers.json sach.
- Chua: Cloudflare that (chi tsc), ClickHouse (id kieu UInt64 chua map), SpendFn cua payments chua gan, attestation, FCM.
- Yeu cau cho agent khac: ops/agents/a3-gateway.requests.md
