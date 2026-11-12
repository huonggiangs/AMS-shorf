STATUS: running
UPDATED: 2026-11-12 (bat dau)

- Dang lam: tools/load (generator + orchestrator Postgres that + Redis that), docs/SLO.md, docs/LOAD-TEST-REPORT.md.
- Phat hien so bo: gateway mac dinh heartbeat 300s (playing) / 600s (idle), COST-MODEL gia dinh 120s.
- Container: 2 vCPU, 8 GB RAM -> generator, gateway, Postgres, Redis tranh nhau 2 nhan; ghi ro trong bao cao.
