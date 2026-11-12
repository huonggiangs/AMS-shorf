// TODO(p0-domain): vung danh dau cho thao tac p0-domain dang bo sung (lenh thiet bi phia admin, trang thai chien dich,
// outbox, chi tieu). KHONG tu bia route o day. Khi route that xuat hien trong app, buildAll() tu dong nhat no
// (admin: qua danh sach route that; gateway: them mo ta vao `defs` trong build.ts). Danh sach duoi day chi la ghi chu
// hien trong `x-todo` cua tai lieu de nguoi doc biet con thieu gi; xoa muc khi da duoc sinh tu ma.
export const P0_PENDING: { admin: string[]; gateway: string[] } = {
  admin: [
    'device command endpoints (create/list/cancel device_commands) - p0-domain',
    'campaign state / outbox / spend visibility endpoints - p0-domain',
  ],
  gateway: ['extra device command types or a dedicated command-fetch endpoint, if p0-domain adds one'],
};
