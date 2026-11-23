-- 0027: tinh nang app tren thiet bi bao cao (heartbeat/register `caps`), luu JSON mang chuoi, vd ["set_volume","reboot"].
-- NULL = app chua bao cao (khong biet); web hien "chua ro" thay vi doan.
ALTER TABLE device_profiles ADD COLUMN caps TEXT;
