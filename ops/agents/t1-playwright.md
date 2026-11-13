STATUS: done
UPDATED: 2026-11-13 UTC

- tests/e2e-ui: Playwright (chromium headless, thu vien `playwright` toan cuc /opt/npm-tools) tren stack that: Postgres 16 embedded + Redis + S3/SMTP gia (tai dung tests/e2e/fakes.ts) + API + gateway + consumer; web-admin build bang vite (.dist), phuc vu bang server Node nho co proxy /api.
- Chay: `pnpm e2e:ui` (E2E_UI_SKIP_BUILD=1 bo qua build; E2E_UI_HEADED=1; E2E_VERBOSE=1). ~25 s, anh o tests/e2e-ui/screenshots.
- Luong: F1 login+TOTP, F2 nap vi /dev/sepay/simulate, F3 cong khach tao+gui duyet, F4 admin duyet (giu 5tr), F5 khach thay Dang phat, F6 ghep doi thiet bi -> trang Thiet bi, F7a/b RBAC (UI + API 403), F8 dang xuat.
- Bug: xem t1-playwright.requests.md (BUG-1 step ngan sach, BUG-2 link moi thieu trang).
