terraform {
  required_version = ">= 1.6.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
  # Trạng thái (state) lưu CỤC BỘ theo workspace. Nhóm làm việc chung nên chuyển sang backend từ xa (R2 qua S3 API).
}

# Token đọc từ biến môi trường CLOUDFLARE_API_TOKEN (không ghi vào mã).
provider "cloudflare" {}
