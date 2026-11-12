# Kubernetes (GIAI ĐOẠN 2 - CHƯA TRIỂN KHAI)

Đây chỉ là **bộ khung** để giữ chỗ cho giai đoạn 2 (đặc tả mục 12: tách đường nóng, hạ tầng riêng).
Hiện chưa có manifest nào chạy được và **chưa được kiểm thử**. Môi trường chuẩn hiện tại:

- Phát triển/demo: Docker Compose (`infra/docker`, `make up`).
- Sản xuất giai đoạn 1: Cloudflare (`infra/cloudflare`, `docs/DEPLOY-CLOUDFLARE.md`).

Khi bắt đầu giai đoạn 2, cùng các image Docker (`services/*/Dockerfile`) sẽ được dùng trên K8s:

```
infra/k8s/
  charts/ams/            # Helm chart (rỗng, đúng cấu trúc)
    Chart.yaml
    values.yaml          # khung giá trị: image, replicas, ingress, secret tham chiếu
    templates/           # Deployment/Service/Ingress/CronJob sẽ thêm ở giai đoạn 2
  # Dự kiến thêm: Redpanda, ClickHouse, Postgres (operator), Redis Cluster, external-secrets
```

Việc cần làm khi kích hoạt: chart cho api/edge-gateway/ingest-consumer/payments, CronJob thay Cron Triggers,
bí mật qua external-secrets, HPA theo lag hàng đợi, dual-write và cắt chuyển theo phần trăm (đặc tả mục 12).
