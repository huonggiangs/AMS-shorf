variable "account_id" {
  description = "Cloudflare Account ID (dash.cloudflare.com > bên phải trang Workers)."
  type        = string
}

variable "zone_id" {
  description = "Zone ID của tên miền (trang Overview của domain)."
  type        = string
}

variable "domain" {
  description = "Tên miền gốc đã thêm vào Cloudflare, ví dụ example.vn (không có https://)."
  type        = string
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
  description = "Số lần tối đa /auth/* mỗi IP trong một chu kỳ."
  type        = number
  default     = 10
}

variable "enable_gateway_rate_limit" {
  description = "Bật luật thứ 2 cho /v1/register và /v1/pair (gói Free chỉ có 1 luật rate-limit)."
  type        = bool
  default     = false
}

variable "gateway_rate_limit" {
  description = "Số lần tối đa register/pair mỗi IP trong một chu kỳ."
  type        = number
  default     = 30
}
