# t1-playwright: yeu cau / bug tim thay (khong sua ma cua agent khac)

## Yeu cau
- Goc `package.json` (f1/f2): dong `"e2e:ui": "pnpm --filter @ams/e2e-ui ui"` da duoc them (1 dong, canh `e2e:smoke`); giu lai.
- `.gitignore`: them `tests/e2e-ui/.dist/` (ban build web tam) va co the `tests/e2e-ui/screenshots/FAIL-*`.

## BUG-1 (web-admin, f3-web) Form "Tao chien dich": nut "Gui duyet" bi trinh duyet chan voi ngan sach mac dinh
- `apps/web-admin/src/pages/Campaigns.tsx` o `<input type="number" min={1} step={100000}>` (Ngan sach de xuat). Mac dinh `5000000` khong hop le theo HTML (gia tri hop le la 1, 100001, ..., 4900001, 5000001). Trinh duyet bao "Please enter a valid value. The two nearest valid values are 4900001 and 5000001" va khong gui form; moi so tron trieu deu bi chan.
- Tai hien: dang nhap khach/admin -> Quang cao -> Tao chien dich moi -> nhap ten -> bam "Gui duyet" (anh `tests/e2e-ui/screenshots/FAIL-F3-*.png` o lan chay cu). "Luu nhap" van chay vi nut type=button.
- Sua: `min={0} step={100000}` hoac bo `step`/dung `step="any"`; hoac `noValidate` va tu kiem tra. Suite hien tai ghi nhan BUG-1 va di vong qua "Luu nhap" -> drawer "Gui duyet".

## BUG-2 (api a1 / web f3) Link moi tai khoan khong co trang tuong ung
- Thu moi khach (kich hoat khi nap tien, `services/payments/src/activation.ts:115`) dung `/invite?token=`; thu moi nguoi dung noi bo (`services/api/src/routes/users.ts` sendInvite) dung `/activate?token=`. Hai duong dan khac nhau va `apps/web-admin/src/App.tsx` chi co route `/login` (khong co /invite, /activate): bam link trong email se roi vao SPA fallback/`Home` -> /login, khach khong dat duoc mat khau qua UI (chi qua API `POST /auth/invite/accept`).
- Tai hien: tao khach + nap tien (hoac moi user), mo link trong thu -> khong co man hinh dat mat khau/TOTP. Can: thong nhat 1 duong dan + trang nhan loi moi (mat khau -> enroll TOTP).

## Ghi chu (khong phai bug)
- Duyet media nay yeu cau `scan_state='clean'` (creatives-scan.ts); suite UI khong chay worker quet nen dat scan_state truc tiep bang SQL.
- Trang `Thanh toan & thue > Tong quan` va `Van hanh` hien "chua co diem cuoi API" (da biet, f3-web.md).
