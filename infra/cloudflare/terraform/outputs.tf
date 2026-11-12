# `terraform output -json > ../ids.<env>.json` rồi chạy scripts/deploy-cloudflare.mjs: script đọc các ID này.
output "d1_core_id" {
  value = cloudflare_d1_database.core.id
}

output "d1_finance_id" {
  value = cloudflare_d1_database.finance.id
}

output "d1_audit_id" {
  value = cloudflare_d1_database.audit.id
}

output "kv_id" {
  value = cloudflare_workers_kv_namespace.kv.id
}

output "hostnames" {
  value = {
    app     = local.app_host
    api     = "${local.app_host}/api"
    gateway = local.gw_host
    sepay   = "https://${local.app_host}/api/webhooks/payments/sepay"
  }
}
