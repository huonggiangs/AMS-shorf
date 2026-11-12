variable "account_id" {
  description = "Cloudflare Account ID (dash.cloudflare.com > bên phải trang Workers)."
  type        = string
}

variable "zone_id" {
  description = "Zone ID của tên miền (trang Overview của domain)."
  type        = string
}

variable "zone_name" {
  description = "Tên zone trên Cloudflare. Zone này PHẢI nằm trong tài khoản Cloudflare của bạn (nameserver đã trỏ về Cloudflare)."
  type        = string
  default     = "anio.vn"
}

variable "environment" {
  description = "staging hoặc production. Dùng một workspace Terraform riêng cho mỗi môi trường."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment phải là staging hoặc production."
  }
}

variable "location_hint" {
  description = "Vùng đặt D1/R2: apac (châu Á-Thái Bình Dương, gần Việt Nam), wnam, enam, weur, eeur, oc."
  type        = string
  default     = "apac"
}

variable "rate_limit_period" {
  description = "Chu kỳ đếm (giây) của rate limit. Gói Free chỉ cho 10; Pro trở lên cho 10/60/120/300/600/3600."
  type        = number
  default     = 10
}

variable "login_rate_limit" {
  description = "Số lần tối đa /api/auth/* mỗi IP trong một chu kỳ."
  type        = number
  default     = 10
}

variable "webhook_rate_limit" {
  description = "Số lần tối đa /api/webhooks/* mỗi IP trong một chu kỳ (SePay chỉ gọi từ vài IP cố định, nên đặt cao hơn đăng nhập)."
  type        = number
  default     = 60
}

variable "enable_webhook_rate_limit" {
  description = "Luật giới hạn /api/webhooks/*. LƯU Ý: gói Free chỉ cho 1 luật rate-limit/zone: đặt false nếu apply báo vượt hạn mức."
  type        = bool
  default     = true
}

variable "enable_gateway_rate_limit" {
  description = "Luật giới hạn /v1/register và /v1/pair trên gw-ams*. Mặc định tắt (cần gói Pro trở lên nếu bật cùng 2 luật kia)."
  type        = bool
  default     = false
}

variable "create_placeholder_dns" {
  description = "Tạo bản ghi DNS giữ chỗ (AAAA 100::, proxied) cho 2 tên máy. CHỈ bật nếu KHÔNG dùng custom domain của wrangler (custom domain tự tạo DNS và sẽ xung đột)."
  type        = bool
  default     = false
}

variable "gateway_rate_limit" {
  description = "Số lần tối đa register/pair mỗi IP trong một chu kỳ."
  type        = number
  default     = 30
}
