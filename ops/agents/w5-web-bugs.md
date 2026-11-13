STATUS: done
UPDATED: 2026-11-13 (UTC)

# w5-web-bugs
- BUG-1: Campaigns.tsx ngan sach min=1000, step=1000 (BUDGET_MIN/BUDGET_STEP), `budgetError()` + goi y duoi o nhap; 5.000.000 hop le nen "Gui duyet" khong bi chan (run.ts nhanh `else` da chay).
- BUG-2: trang /invite (khach) va /activate (noi bo) - `pages/Invite.tsx` (AcceptInvite dung chung), `pages/Activate.tsx`; route them trong App.tsx ngoai Guard. Luong: mat khau (12 ky tu hoa/thuong/so, danh sach quy tac + meter) -> POST /auth/invite/accept -> POST /auth/mfa/enroll -> QR (qrcode-generator 1.4.4, them vao web-admin) + khoa -> POST /auth/mfa/verify -> reload -> '/'.
- Test: src/test/invite-activate.test.tsx; e2e moi tests/e2e-ui/invite.ts (`pnpm --filter @ams/e2e-ui invite`). .gitignore: tests/e2e-ui/.dist/ (anh chup giu lai).

## Yeu cau cho agent khac (api)
- Thieu `GET /auth/invite/info?token=` (khong tieu thu token) tra {email,name,role,customer_name}; trang da goi tuy chon, khong co thi hien cau chung.
- Quy tac mat khau /auth/invite/accept (>=10, chu+so) yeu hon doi mat khau (12, hoa/thuong/so); UI ep quy tac 12 ky tu; nen thong nhat bang passwordPolicyError.
- Link khach dung /invite, noi bo /activate (hai trang cung component; khach cung bat buoc TOTP do server).
