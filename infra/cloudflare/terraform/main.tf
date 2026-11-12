# AMS - tài nguyên Cloudflare cho một môi trường (staging | production).
# Cách dùng: xem docs/DEPLOY-CLOUDFLARE.md (phần "Cách B: Terraform").
# Cú pháp theo provider cloudflare v5. CHƯA được chạy `terraform validate/plan` trong môi trường tạo ra tệp này.

locals {
  env = var.environment
  # Tên máy chủ (khớp infra/cloudflare/*/wrangler.toml). Cấp MỘT: Universal SSL miễn phí chỉ phủ *.anio.vn.
  app_label = var.environment == "production" ? "ams" : "ams-stg"
  gw_label  = var.environment == "production" ? "gw-ams" : "gw-ams-stg"
  app_host  = "${local.app_label}.${var.zone_name}"
  gw_host   = "${local.gw_label}.${var.zone_name}"
}

# ---------------------------------------------------------------- D1 theo miền (đặc tả 4.1)
resource "cloudflare_d1_database" "core" {
  account_id            = var.account_id
  name                  = "ams-core-${local.env}"
  primary_location_hint = var.location_hint
}

resource "cloudflare_d1_database" "finance" {
  account_id            = var.account_id
  name                  = "ams-finance-${local.env}"
  primary_location_hint = var.location_hint
}

resource "cloudflare_d1_database" "audit" {
  account_id            = var.account_id
  name                  = "ams-audit-${local.env}"
  primary_location_hint = var.location_hint
}

# ---------------------------------------------------------------- KV
resource "cloudflare_workers_kv_namespace" "kv" {
  account_id = var.account_id
  title      = "ams-kv-${local.env}"
}

# ---------------------------------------------------------------- Queues (+ hàng đợi lỗi)
resource "cloudflare_queue" "ingest" {
  account_id = var.account_id
  queue_name = "ams-ingest-${local.env}"
}

resource "cloudflare_queue" "ingest_dlq" {
  account_id = var.account_id
  queue_name = "ams-ingest-dlq-${local.env}"
}

resource "cloudflare_queue" "jobs" {
  account_id = var.account_id
  queue_name = "ams-jobs-${local.env}"
}

resource "cloudflare_queue" "jobs_dlq" {
  account_id = var.account_id
  queue_name = "ams-jobs-dlq-${local.env}"
}

# ---------------------------------------------------------------- R2
resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = "ams-media-${local.env}"
  location   = var.location_hint
}

resource "cloudflare_r2_bucket" "reports" {
  account_id = var.account_id
  name       = "ams-reports-${local.env}"
  location   = var.location_hint
}

# Bản sao audit log bất biến. Khóa đối tượng (object lock/retention) bật thủ công trên dashboard R2 sau khi tạo.
resource "cloudflare_r2_bucket" "audit" {
  account_id = var.account_id
  name       = "ams-audit-${local.env}"
  location   = var.location_hint
}

# ---------------------------------------------------------------- DNS
# Mặc định KHÔNG tạo: custom domain trong wrangler.toml tự tạo bản ghi proxied cho ams.anio.vn và gw-ams.anio.vn.
resource "cloudflare_dns_record" "hosts" {
  for_each = var.create_placeholder_dns ? toset([local.app_host, local.gw_host]) : toset([])
  zone_id  = var.zone_id
  name     = each.key
  type     = "AAAA"
  content  = "100::"
  proxied  = true
  ttl      = 1
  comment  = "AMS ${local.env} (Terraform)"
}

# ---------------------------------------------------------------- WAF: giới hạn tốc độ cơ bản
# Thiết bị gọi /v1/heartbeat rất nhiều nên KHÔNG giới hạn theo IP cho heartbeat (kiểm soát trong gateway bằng chữ ký + KV).
resource "cloudflare_ruleset" "rate_limit" {
  zone_id     = var.zone_id
  name        = "ams-${local.env}-rate-limit"
  description = "Giới hạn /api/auth/*, /api/webhooks/* (và register/pair thiết bị) theo IP"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = concat(
    [
      {
        action      = "block"
        description = "AMS ${local.env}: /api/auth/* (đăng nhập, MFA, nhận lời mời)"
        enabled     = true
        expression  = "(http.host eq \"${local.app_host}\" and starts_with(http.request.uri.path, \"/api/auth/\"))"
        ratelimit = {
          characteristics     = ["ip.src"]
          period              = var.rate_limit_period
          requests_per_period = var.login_rate_limit
          mitigation_timeout  = var.rate_limit_period
        }
      }
    ],
    var.enable_webhook_rate_limit ? [
      {
        action      = "block"
        description = "AMS ${local.env}: /api/webhooks/* (SePay)"
        enabled     = true
        expression  = "(http.host eq \"${local.app_host}\" and starts_with(http.request.uri.path, \"/api/webhooks/\"))"
        ratelimit = {
          characteristics     = ["ip.src"]
          period              = var.rate_limit_period
          requests_per_period = var.webhook_rate_limit
          mitigation_timeout  = var.rate_limit_period
        }
      }
    ] : [],
    var.enable_gateway_rate_limit ? [
      {
        action      = "block"
        description = "AMS ${local.env}: register/pair thiết bị"
        enabled     = true
        expression  = "(http.host eq \"${local.gw_host}\" and (http.request.uri.path eq \"/v1/register\" or http.request.uri.path eq \"/v1/pair\"))"
        ratelimit = {
          characteristics     = ["ip.src"]
          period              = var.rate_limit_period
          requests_per_period = var.gateway_rate_limit
          mitigation_timeout  = var.rate_limit_period
        }
      }
    ] : []
  )
}
