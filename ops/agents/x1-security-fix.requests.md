# Yeu cau tu x1-security-fix
- w1: R1-03 media.ts approve phai 409 neu scan_state != 'clean'; gui MEDIA_TOPIC khi confirm; R1-14 content_version; R1-10 presign gioi han kich thuoc; R1-19/R1-24 auth.
- w3: docker-compose: GATEWAY_DEV_ENDPOINTS mac dinh 0; bucket chi mo prefix renditions/ => dat MANIFEST_REQUIRE_RENDITION=1 cho gateway; AMS_ENV phai duoc truyen vao gateway; scripts/setup.mjs check-env (root scripts/, khong phai packages/shared) tu choi GATEWAY_DEV_ENDPOINTS=1 va change-me* ngoai AMS_ENV=local.
- API khoi dong (services/api, chua lam): tu choi change-me* ngoai local (app.ts/index thuoc a1; can nguoi so huu).
- s1/w4: R1-02, 05, 06, 16, 18.
- runtime owner: R1-12 kv.incr Cloudflare khong nguyen tu (cap impression R1-04 phu thuoc).
