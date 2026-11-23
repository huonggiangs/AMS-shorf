/* Sinh tu docs/openapi/ams-device-gateway.json bang packages/sdk-ts/scripts/generate.ts. KHONG sua tay. */
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sức khỏe dịch vụ */
        get: operations["GetHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/commands/ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Báo kết quả lệnh */
        post: operations["gatewayPostCommandsAck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/commands/wait": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Long-poll lệnh (tin khẩn thời gian thực)
         * @description Giữ kết nối tối đa `timeout` giây (1–25, mặc định 25) và trả ngay khi có lệnh pending (kiểm cờ hàng đợi mỗi ~1,5 giây). Lệnh giao at-least-once như heartbeat; ack qua /v1/commands/ack. Giới hạn 600 lần/giờ/thiết bị (429 + `Retry-After`). Thiết bị vẫn heartbeat định kỳ.
         */
        get: operations["gatewayGetCommandsWait"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Gửi lô sự kiện (tối đa 50, idempotent theo event_id)
         * @description Thân tối đa 16 KB. Impression hợp lệ khi vcr_pct >= ngưỡng; sự kiện không có trong manifest bị từ chối từng cái (`rejected`). `proof_of_play` (thang máy/LED): thiết bị đã được cấp quyền => hợp lệ (`valid`); chưa cấp quyền => vẫn lưu với trạng thái `pending_trust` (đếm vào `flagged`, không bị loại, tính lại khi được cấp quyền); không bao giờ sinh doanh thu/thưởng ở gateway.
         */
        post: operations["gatewayPostEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Nhịp sống + nhận lệnh
         * @description Thân tối đa 2 KB. Trả khoảng nghỉ kế tiếp có jitter, etag manifest và lệnh đang chờ (giao at-least-once; xác nhận qua `cmd_ack` hoặc /v1/commands/ack). 429/503 kèm `Retry-After`. Thang máy/LED có thể gửi `source` (ams|usb|lan), `app_version`, `cache_mb`, `px_w`/`px_h`/`orientation`/`region` (tùy chọn); nhận thêm `hotline`, `app_update_url`, `app_update_sha256`, `min_app_version` khi có cấu hình.
         */
        post: operations["gatewayPostHeartbeat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/interactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Báo tương tác (nhấp / quét QR), tối đa 10 sự kiện/lô, khử trùng theo event_id
         * @description Xác thực bằng chữ ký thiết bị (phone hoặc tv, đã ghép: trust_level >= 1). Thưởng = `interaction_reward_vnd` của chiến dịch (tối đa `INTERACTION_MAX_REWARD_VND`=50), ghi `wallet_ledger` bất biến, một lần theo event_id. Giới hạn: 20 lô/phút/thiết bị, 30 tương tác/người/ngày, 3/chiến dịch/người/ngày, trần thưởng/ngày. Gửi lại event_id => `duplicate` (không cộng lại). Sự kiện từ chối nằm ở `rejected` (vd `untrusted_device`, `not_in_manifest`, `campaign_cap`).
         */
        post: operations["gatewayPostInteractions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Gửi nhật ký thiết bị (Signage Player)
         * @description Thân tối đa 8 KB, tối đa 100 dòng. Giới hạn tần suất theo device_id (mặc định 60 lần/giờ, 5000 dòng/ngày; 429 + `Retry-After`). `ts` quá cũ bị kẹp về mốc 7 ngày, tương lai kẹp +5 phút. Lưu 7 ngày; quản trị xem ở ngăn chi tiết thiết bị.
         */
        post: operations["gatewayPostLogs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/manifest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Manifest của thiết bị (đầy đủ hoặc delta)
         * @description Điều kiện: `If-None-Match`/`?etag=` trùng => 304. `?delta=1&etag=<base>` => bản delta nếu còn. Header `X-Manifest-Kind: full|delta`. Thiết bị PHẢI kiểm `sha256` từng creative trước khi phát.
         */
        get: operations["gatewayGetManifest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/manifest/g/{group}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Manifest công khai theo nhóm (cache CDN)
         * @description Không cần chữ ký; tắt bằng `MANIFEST_PUBLIC=0`. `group` lấy từ `manifest_group` của heartbeat.
         */
        get: operations["gatewayGetManifestGByGroup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Xin mã ghép đôi 6 số / hỏi trạng thái ghép đôi
         * @description Body rỗng. Hiển thị `code` trên TV; người dùng nhập vào app điện thoại (API khách gọi `redeemPairingCode`).
         */
        post: operations["gatewayPostPair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Đăng ký thiết bị (idempotent theo pubkey)
         * @description Ký bằng chính khóa riêng tương ứng `pubkey` trong body (không có X-Device-Id). Trả `attestation_nonce` để kiểm chứng. Giới hạn theo IP. Cùng `pubkey` LUÔN nhận lại cùng `device_id` (200). Thang máy/LED gửi thêm `px_w`, `px_h`, `orientation`, `region` để vào đúng nhóm manifest `elevator_<w>x<h>`; chờ vận hành cấp quyền trên admin (không dùng mã 6 số).
         */
        post: operations["gatewayPostRegister"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tax-authorization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Chế độ thuế hiện tại của người nhận chi trả */
        get: operations["gatewayGetTaxAuthorization"];
        put?: never;
        /**
         * Chọn/đổi chế độ thuế: `auto_pay` (thanh toán tự động, chấp nhận chi trả thuế), `delegate` (ủy quyền ứng dụng nộp thuế) hoặc `none` (thu hồi)
         * @description Chỉ LƯU ý chí và đồng ý (lịch sử chỉ thêm dòng; `none` = thu hồi). **Chưa khấu trừ hay nộp thuế thật** (`remittance_active=false`). `tax_code` (MST, tùy chọn, mã hóa khi lưu). `consent_version` phải khớp phiên bản điều khoản hiện hành.
         */
        post: operations["gatewayPostTaxAuthorization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/viewer/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Điện thoại nhập mã 6 số của TV để ghép đôi (người xem)
         * @description Chỉ thiết bị `kind=phone`. Mã 6 số hết hạn sau 5 phút, dùng một lần. Chống dò: sai quá 5 lần/15 phút/thiết bị => 429 `rate_limited` (Retry-After 900); giới hạn theo IP. Mã sai/hết hạn/đã dùng trả cùng một lỗi `invalid_code` (404). Lần ghép đầu tạo người dùng cho điện thoại và nâng trust_level lên 1.
         */
        post: operations["gatewayPostViewerPair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/viewer/phone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Xác minh số điện thoại bằng OTP (không có `otp` => gửi OTP; có `otp` => xác minh)
         * @description Cần đã ghép TV. 202 khi đã gửi OTP. Kênh gửi OTP chưa được cấu hình => 503 `not_configured`. OTP 6 số, hết hạn 5 phút, tối đa 5 lần thử, 3 lần gửi/giờ.
         */
        post: operations["gatewayPostViewerPhone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/wallet": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ví thưởng của người xem
         * @description Chỉ điện thoại (`kind=phone`). `balance_vnd` là số dư khả dụng (sổ cái trừ lệnh rút đang chờ). Điện thoại chưa ghép TV nhận ví 0 với `paired=false`.
         */
        get: operations["gatewayGetWallet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/wallet/ledger": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sao kê ví (phân trang theo con trỏ, mới nhất trước) */
        get: operations["gatewayGetWalletLedger"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yêu cầu rút thưởng (tạo lệnh CHỜ tài chính duyệt, KHÔNG tự chuyển tiền)
         * @description Điều kiện: bật `VIEWER_WITHDRAW_ENABLED=1` (mặc định tắt => 403 `feature_disabled`), đã xác minh điện thoại, đã chọn chế độ thuế (nếu `PAYOUT_REQUIRE_TAX_CONSENT`; có thể gửi kèm `tax_authorization` trong chính yêu cầu rút, tương thích app Mindo), `amount_vnd >= PAYOUT_THRESHOLD_VND` (100.000) và <= số dư khả dụng, không có lệnh rút nào đang chờ.
         *
         *     OTP: gọi lần đầu KHÔNG có `otp` => 403 `otp_required` (và gửi OTP tới số đã xác minh); gọi lại cùng thân kèm `otp`. OTP gắn với đúng số tiền + tài khoản nhận.
         *
         *     Idempotent theo `idempotency_key` (8-64 ký tự): gửi lại cùng khóa => 200 trả lệnh cũ (không cần OTP mới); cùng khóa khác nội dung => 409 `idempotency_conflict`.
         *
         *     Tài khoản nhận lưu mã hóa AES-GCM; nhân viên tài chính duyệt/chi ở `/admin/v1/payouts/{id}/pay|reject`.
         */
        post: operations["gatewayPostWithdraw"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        CommandAckRequest: {
            acks: ({
                id: string;
                /**
                 * @default ok
                 * @enum {string}
                 */
                status: "ok" | "failed";
                result?: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        CommandAckResponse: {
            /** @constant */
            ok: true;
            acked: number;
            known: number;
            /** @description id khong thuoc thiet bi nay (bo qua, khong loi) */
            unknown: string[];
        } & {
            [key: string]: unknown;
        };
        ErrorBody: {
            error: {
                /** @description snake_case, vd validation_error, forbidden, not_found, invalid_state */
                code: string;
                /** @description Tiếng Việt cho người dùng */
                message: string;
                details?: unknown;
            };
        };
        EventsRequest: {
            events: (({
                /** @constant */
                type: "impression";
                event_id: string;
                /** Format: date-time */
                ts: string;
                campaign_id: string;
                creative_id: string;
                slot_id?: string;
                vcr_pct: number;
                played_ms: number;
            } & {
                [key: string]: unknown;
            }) | ({
                /** @constant */
                type: "proof_of_play";
                event_id: string;
                /** Format: date-time */
                ts: string;
                creative_id: string;
                duration_ms: number;
            } & {
                [key: string]: unknown;
            }))[];
        } & {
            [key: string]: unknown;
        };
        EventsResponse: {
            accepted: number;
            valid: number;
            flagged: number;
            rejected: ({
                event_id: string | null;
                reason: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        GenericObject: {
            [key: string]: unknown;
        };
        Health: {
            /** @constant */
            ok: true;
            service: string;
            runtime: string;
            time?: string;
        } & {
            [key: string]: unknown;
        };
        HeartbeatRequest: {
            /** @default 0 */
            state: number;
            app_ver?: string;
            soc_temp?: number;
            rssi?: number;
            dl_mbps?: number;
            cache_used_mb?: number;
            cache_slots?: number;
            manifest_etag?: string;
            cmd_ack?: string[];
            app_version?: string;
            cache_mb?: number;
            /** @enum {string} */
            source?: "ams" | "usb" | "lan";
            px_w?: number;
            px_h?: number;
            /** @enum {string} */
            orientation?: "landscape" | "portrait";
            region?: string;
            volume?: number;
        } & {
            [key: string]: unknown;
        };
        HeartbeatResponse: {
            /** @constant */
            ok: true;
            /** Format: date-time */
            server_time: string;
            /** @description giay, da cong jitter */
            next_interval: number;
            interval_base: number;
            manifest_etag: string;
            manifest_group: string;
            /** @description duong tuong doi /v1/manifest/g/{group} */
            manifest_url: string;
            /** @description lenh cho thiet bi, giao at-least-once; ack bang cmd_ack trong heartbeat ke tiep hoac POST /v1/commands/ack */
            commands: ({
                /** @description id dong trong bang device_commands */
                id: string;
                /** @description refresh_manifest, reboot, set_monitor; Signage Player: reset_pin (args rong), set_volume {percent 0-100}, set_orientation {orientation landscape|portrait}, message {text <= 200, duration_s? 3-120}; TV: lock, unlock, message {text, seconds}... Type la: bo qua nhung VAN ack. */
                type: string;
                args?: {
                    [key: string]: unknown;
                };
            } & {
                [key: string]: unknown;
            })[];
            min_app_version?: string;
            /** @description CHI thang may/LED, khi co cau hinh: hotline/Zalo hien o man hinh logo (luu de hien ca khi mat mang) */
            hotline?: string;
            /** @description CHI thang may/LED, khi co cau hinh: URL HTTPS tai ban cap nhat app (di kem app_update_sha256) */
            app_update_url?: string;
            /** @description SHA-256 hex cua tep cap nhat; app PHAI kiem truoc khi cai */
            app_update_sha256?: string;
        } & {
            [key: string]: unknown;
        };
        InteractionsRequest: {
            events: ({
                /** @constant */
                type?: "interaction";
                event_id: string;
                /** Format: date-time */
                ts: string;
                /** @enum {string} */
                kind?: "tap" | "qr_scan";
                /** @enum {string} */
                interaction?: "tap" | "qr_scan";
                campaign_id: string;
                creative_id: string;
                slot_id?: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        InteractionsResponse: {
            accepted: number;
            valid: number;
            credited_vnd: number;
            rejected: ({
                event_id: string;
                reason: string;
            } & {
                [key: string]: unknown;
            })[];
            results: ({
                event_id: string;
                /** @enum {string} */
                status: "credited" | "recorded" | "duplicate" | "rejected";
                credited_vnd: number;
                reason?: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        LedgerResponse: {
            items: ({
                id: string;
                kind: string;
                amount_vnd: number;
                status: string;
                created_at: string;
                ref_type: string | null;
            } & {
                [key: string]: unknown;
            })[];
            next_cursor?: string;
        } & {
            [key: string]: unknown;
        };
        LogsRequest: {
            entries: ({
                /** Format: date-time */
                ts: string;
                /**
                 * @default info
                 * @enum {string}
                 */
                level: "debug" | "info" | "warn" | "error";
                tag?: string;
                msg: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        LogsResponse: {
            /** @constant */
            ok: true;
            /** @description so dong da luu */
            stored: number;
        } & {
            [key: string]: unknown;
        };
        Manifest: {
            version: number;
            group: string;
            /** @description start_min/end_min tinh theo mui gio nay (Asia/Ho_Chi_Minh) */
            tz: string;
            etag: string;
            /** Format: date-time */
            generated_at: string;
            ttl_s: number;
            creatives: ({
                id: string;
                campaign_id: string;
                url: string;
                /** @description hex; thiet bi PHAI kiem tra truoc khi phat. Chi co o creative tai len; creative delivery=stream KHONG co sha256 */
                sha256?: string;
                /**
                 * @description vang mat = tai len (tai ve + kiem sha256); 'stream' = phat truc tiep tu url ben ngoai (ExoPlayer/Media3), khong tai ve
                 * @constant
                 */
                delivery?: "stream";
                /**
                 * @description chi voi delivery=stream: dinh dang luong
                 * @enum {string}
                 */
                kind?: "mp4" | "webm" | "hls" | "dash";
                /** @description chi voi delivery=stream: thoi luong khai bao (ms), dung cho quy tac 0.9 x thoi luong */
                duration_ms?: number;
                /** @description chi voi delivery=stream: ETag luc duyet (neu co) */
                etag?: string | null;
                duration_s: number | null;
                px_w: number | null;
                px_h: number | null;
                /** @enum {string} */
                format: "fullscreen" | "menu_banner" | "l_banner" | "pause_ad" | "qr_corner" | "reward";
                overlay?: {
                    sponsor_tag?: string;
                    brand_label?: string;
                    headline?: string;
                    hotline?: {
                        label?: string;
                        number: string;
                        sub?: string;
                    } & {
                        [key: string]: unknown;
                    };
                    qr?: {
                        url: string;
                        label?: string;
                        title?: string;
                    } & {
                        [key: string]: unknown;
                    };
                    scte_id?: string;
                    badges?: string[];
                } & {
                    [key: string]: unknown;
                };
                /** @enum {string} */
                media_type: "video" | "image";
                size_bytes: number | null;
                /**
                 * @description CHI thang may/LED: cach hien trong khung (mac dinh fit = vua khung, giu ti le, co vien den neu lech; cover = phu kin, co the cat mep)
                 * @enum {string}
                 */
                fit?: "fit" | "cover";
            } & {
                [key: string]: unknown;
            })[];
            schedule: ({
                slot_id: string;
                campaign_id: string;
                creative_ids: string[];
                daypart: string;
                start_min: number;
                end_min: number;
                priority: number;
                reward_points: number;
                /** @description CHI thang may/LED: ghi de header cap manifest cho lich nay (chuoi rong = an) */
                header?: string;
                /** @description CHI thang may/LED: ghi de footer cap manifest cho lich nay (chuoi rong = an) */
                footer?: string;
                /** @description CHI lich noi bo (slot bp_*) co bo cuc da vung; thiet bi cu bo qua truong la */
                layout?: {
                    /** @enum {string} */
                    orientation: "landscape" | "portrait";
                    zones: ({
                        id: string;
                        /** @enum {string} */
                        type: "video" | "image" | "marquee" | "text" | "clock" | "weather" | "qr";
                        /** @description % khung, 0..100 */
                        x: number;
                        y: number;
                        w: number;
                        h: number;
                        z?: number;
                        /** @enum {string} */
                        transition?: "none" | "fade" | "slide-left" | "slide-right" | "zoom";
                        /** @description Van ban thuan (thiet bi cu chi doc truong nay) */
                        text?: string;
                        /** @description Van ban dinh dang cho vung marquee/text: tap con HTML da lam sach (p, b, i, u, s, span, br); thieu = dung text */
                        rich?: string;
                        bg_color?: string;
                        text_color?: string;
                        font_size?: number;
                        scroll_speed?: number;
                        url?: string;
                        /**
                         * @description CHI vung qr: text = ve QR tu url; image_url = tai anh tu url (VietQR); data_url = anh nhung
                         * @enum {string}
                         */
                        qr_kind?: "text" | "image_url" | "data_url";
                        /** @description CHI vung qr: cau hinh goc (mode image|url|vietqr) */
                        qr?: {
                            [key: string]: unknown;
                        };
                        /** @description CHI vung weather: thiet bi tu lay Open-Meteo (api.open-meteo.com) theo lat/lon */
                        weather?: {
                            /** @enum {string} */
                            mode: "gps" | "fixed";
                            lat?: number;
                            lon?: number;
                            label?: string;
                        } & {
                            [key: string]: unknown;
                        };
                        /** @description CHI vung video/image: tep phat o vung nay, theo thu tu */
                        creative_ids?: string[];
                    } & {
                        [key: string]: unknown;
                    })[];
                } & {
                    [key: string]: unknown;
                };
            } & {
                [key: string]: unknown;
            })[];
            /** @description CHI thang may/LED: chu header (rong = an) */
            header?: string;
            /** @description CHI thang may/LED: chu footer (rong = an) */
            footer?: string;
            /** @description CHI thang may/LED: hotline/Zalo (dung khi mat mang) */
            hotline?: string;
            /** @description CHI thang may/LED: phat tuan tu theo priority tang dan, lap vo han; cung priority theo slot_id */
            rotation?: {
                /** @constant */
                mode: "sequential";
            } & {
                [key: string]: unknown;
            };
        } & {
            [key: string]: unknown;
        };
        ManifestDelta: {
            version: number;
            group: string;
            etag: string;
            base_etag: string;
            /** Format: date-time */
            generated_at: string;
            ttl_s: number;
            creatives_added: ({
                id: string;
                campaign_id: string;
                url: string;
                /** @description hex; thiet bi PHAI kiem tra truoc khi phat. Chi co o creative tai len; creative delivery=stream KHONG co sha256 */
                sha256?: string;
                /**
                 * @description vang mat = tai len (tai ve + kiem sha256); 'stream' = phat truc tiep tu url ben ngoai (ExoPlayer/Media3), khong tai ve
                 * @constant
                 */
                delivery?: "stream";
                /**
                 * @description chi voi delivery=stream: dinh dang luong
                 * @enum {string}
                 */
                kind?: "mp4" | "webm" | "hls" | "dash";
                /** @description chi voi delivery=stream: thoi luong khai bao (ms), dung cho quy tac 0.9 x thoi luong */
                duration_ms?: number;
                /** @description chi voi delivery=stream: ETag luc duyet (neu co) */
                etag?: string | null;
                duration_s: number | null;
                px_w: number | null;
                px_h: number | null;
                /** @enum {string} */
                format: "fullscreen" | "menu_banner" | "l_banner" | "pause_ad" | "qr_corner" | "reward";
                overlay?: {
                    sponsor_tag?: string;
                    brand_label?: string;
                    headline?: string;
                    hotline?: {
                        label?: string;
                        number: string;
                        sub?: string;
                    } & {
                        [key: string]: unknown;
                    };
                    qr?: {
                        url: string;
                        label?: string;
                        title?: string;
                    } & {
                        [key: string]: unknown;
                    };
                    scte_id?: string;
                    badges?: string[];
                } & {
                    [key: string]: unknown;
                };
                /** @enum {string} */
                media_type: "video" | "image";
                size_bytes: number | null;
                /**
                 * @description CHI thang may/LED: cach hien trong khung (mac dinh fit = vua khung, giu ti le, co vien den neu lech; cover = phu kin, co the cat mep)
                 * @enum {string}
                 */
                fit?: "fit" | "cover";
            } & {
                [key: string]: unknown;
            })[];
            /** @description creative bi go; thang may/LED: ca id creative DOI noi dung (cung id xuat hien trong creatives_added) de client thay the */
            creatives_removed: string[];
            schedule: ({
                slot_id: string;
                campaign_id: string;
                creative_ids: string[];
                daypart: string;
                start_min: number;
                end_min: number;
                priority: number;
                reward_points: number;
                /** @description CHI thang may/LED: ghi de header cap manifest cho lich nay (chuoi rong = an) */
                header?: string;
                /** @description CHI thang may/LED: ghi de footer cap manifest cho lich nay (chuoi rong = an) */
                footer?: string;
                /** @description CHI lich noi bo (slot bp_*) co bo cuc da vung; thiet bi cu bo qua truong la */
                layout?: {
                    /** @enum {string} */
                    orientation: "landscape" | "portrait";
                    zones: ({
                        id: string;
                        /** @enum {string} */
                        type: "video" | "image" | "marquee" | "text" | "clock" | "weather" | "qr";
                        /** @description % khung, 0..100 */
                        x: number;
                        y: number;
                        w: number;
                        h: number;
                        z?: number;
                        /** @enum {string} */
                        transition?: "none" | "fade" | "slide-left" | "slide-right" | "zoom";
                        /** @description Van ban thuan (thiet bi cu chi doc truong nay) */
                        text?: string;
                        /** @description Van ban dinh dang cho vung marquee/text: tap con HTML da lam sach (p, b, i, u, s, span, br); thieu = dung text */
                        rich?: string;
                        bg_color?: string;
                        text_color?: string;
                        font_size?: number;
                        scroll_speed?: number;
                        url?: string;
                        /**
                         * @description CHI vung qr: text = ve QR tu url; image_url = tai anh tu url (VietQR); data_url = anh nhung
                         * @enum {string}
                         */
                        qr_kind?: "text" | "image_url" | "data_url";
                        /** @description CHI vung qr: cau hinh goc (mode image|url|vietqr) */
                        qr?: {
                            [key: string]: unknown;
                        };
                        /** @description CHI vung weather: thiet bi tu lay Open-Meteo (api.open-meteo.com) theo lat/lon */
                        weather?: {
                            /** @enum {string} */
                            mode: "gps" | "fixed";
                            lat?: number;
                            lon?: number;
                            label?: string;
                        } & {
                            [key: string]: unknown;
                        };
                        /** @description CHI vung video/image: tep phat o vung nay, theo thu tu */
                        creative_ids?: string[];
                    } & {
                        [key: string]: unknown;
                    })[];
                } & {
                    [key: string]: unknown;
                };
            } & {
                [key: string]: unknown;
            })[];
            /** @description CHI thang may/LED: chu header (rong = an) */
            header?: string;
            /** @description CHI thang may/LED: chu footer (rong = an) */
            footer?: string;
            /** @description CHI thang may/LED: hotline/Zalo (dung khi mat mang) */
            hotline?: string;
            /** @description CHI thang may/LED: phat tuan tu theo priority tang dan, lap vo han; cung priority theo slot_id */
            rotation?: {
                /** @constant */
                mode: "sequential";
            } & {
                [key: string]: unknown;
            };
        } & {
            [key: string]: unknown;
        };
        PairResponse: ({
            /** @constant */
            paired: true;
            trust_level: number;
        } & {
            [key: string]: unknown;
        }) | ({
            /** @constant */
            paired: false;
            code: string;
            /** Format: date-time */
            expires_at: string;
            expires_in: number;
            ttl_s: number;
        } & {
            [key: string]: unknown;
        });
        RegisterRequest: {
            pubkey: string;
            /**
             * @default tv
             * @enum {string}
             */
            kind: "tv" | "elevator" | "led_p5" | "phone" | "virtual";
            model?: string;
            os?: string;
            app_version?: string;
            region?: string;
            px_w?: number;
            px_h?: number;
            /** @enum {string} */
            orientation?: "landscape" | "portrait";
        } & {
            [key: string]: unknown;
        };
        RegisterResponse: {
            device_id: string;
            trust_level: number;
            attestation_nonce: string;
            /** Format: date-time */
            server_time: string;
            protocol: number;
            /** @description giay */
            heartbeat_interval: number;
            /** @description true => 201 (thiet bi moi), false => 200 (da dang ky truoc) */
            created: boolean;
        } & {
            [key: string]: unknown;
        };
        TaxAuthRequest: {
            /** @enum {string} */
            mode: "none" | "auto_pay" | "delegate";
            consent_version: string;
            tax_code?: string;
        } & {
            [key: string]: unknown;
        };
        TaxAuthResponse: {
            /** @enum {string} */
            mode: "none" | "auto_pay" | "delegate";
            /**
             * @description trung mode, ten truong cua app Mindo
             * @enum {string}
             */
            tax_authorization: "none" | "auto_pay" | "delegate";
            consent_version: string | null;
            updated_at: string | null;
            current_consent_version: string;
            modes: string[];
            /**
             * @description CHUA khau tru/nop thue that
             * @constant
             */
            remittance_active: false;
        } & {
            [key: string]: unknown;
        };
        ViewerPairRequest: {
            code: string;
        } & {
            [key: string]: unknown;
        };
        ViewerPairResponse: {
            /** @constant */
            paired: true;
            /** @description device_id cua TV vua ghep */
            device_id: string;
            trust_level: number;
            already?: boolean;
        } & {
            [key: string]: unknown;
        };
        ViewerPhoneOtp: {
            /** @constant */
            otp_sent: true;
            expires_in: number;
            phone_masked: string;
            /** @description CHI local/test khi VIEWER_OTP_DEV_ECHO=1 */
            dev_otp?: string;
        } & {
            [key: string]: unknown;
        };
        ViewerPhoneRequest: {
            phone: string;
            otp?: string;
        } & {
            [key: string]: unknown;
        };
        ViewerPhoneVerified: {
            /** @constant */
            verified: true;
            phone_masked: string;
        } & {
            [key: string]: unknown;
        };
        WalletResponse: {
            paired: boolean;
            /** @description so du KHA DUNG = so cai - lenh rut dang cho */
            balance_vnd: number;
            ledger_balance_vnd: number;
            pending_payout_vnd: number;
            total_paid_vnd: number;
            /** @description so luot xem DA CO THUONG (chien dich phu) */
            views: number;
            /** @description so tuong tac DA CO THUONG */
            interactions: number;
            payouts: ({
                id: string;
                amount_vnd: number;
                /** @enum {string} */
                status: "pending" | "paid" | "rejected";
                requested_at: string;
                paid_at: string | null;
            } & {
                [key: string]: unknown;
            })[];
            devices: ({
                device_id: string;
                name: string | null;
                paired_at: string | null;
            } & {
                [key: string]: unknown;
            })[];
            /** @enum {string} */
            tax_mode: "none" | "auto_pay" | "delegate";
            /**
             * @description trung tax_mode, ten truong cua app Mindo
             * @enum {string}
             */
            tax_authorization: "none" | "auto_pay" | "delegate";
            phone_verified: boolean;
            today_reward_vnd?: number;
            /** @description don gia chi de hien thi (20 d) */
            unit_price_vnd: number;
            /** @description moc nhan thuong cong don (mac dinh 100000) */
            payout_threshold_vnd: number;
            interaction_reward_range_vnd: number[];
            daily_reward_cap_vnd: number;
            /** @description false => POST /v1/withdraw tra feature_disabled */
            withdraw_enabled: boolean;
        } & {
            [key: string]: unknown;
        };
        WithdrawRequest: {
            amount_vnd: number;
            bank: {
                bank_code?: string;
                bank_name: string;
                account_number: string;
                account_name: string;
            } & {
                [key: string]: unknown;
            };
            otp?: string;
            /** @enum {string} */
            tax_authorization?: "none" | "auto_pay" | "delegate";
            idempotency_key: string;
        } & {
            [key: string]: unknown;
        };
        WithdrawResponse: {
            payout_id: string;
            id: string;
            /** @enum {string} */
            status: "pending" | "paid" | "rejected";
            amount_vnd: number;
            requested_at: string;
            /** @constant */
            review: "awaiting_finance_approval";
            /** @description true => 200, tra lai lenh cu theo idempotency_key */
            idempotent_replay?: boolean;
        } & {
            [key: string]: unknown;
        };
    };
    responses: {
        /** @description Lỗi: luôn có dạng { error: { code, message, details? } } */
        Error: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorBody"];
            };
        };
        /** @description Quá tải hoặc quá giới hạn: chờ `Retry-After` giây rồi thử lại */
        RetryLater: {
            headers: {
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorBody"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    GetHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    gatewayPostCommandsAck: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommandAckRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandAckResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayGetCommandsWait: {
        parameters: {
            query?: {
                timeout?: number;
            };
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Danh sách lệnh (rỗng nếu hết thời gian chờ) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        commands?: Record<string, never>[];
                        waited?: boolean;
                    };
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostEvents: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventsRequest"];
            };
        };
        responses: {
            /** @description Đã nhận */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventsResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostHeartbeat: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["HeartbeatRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HeartbeatResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostInteractions: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InteractionsRequest"];
            };
        };
        responses: {
            /** @description Đã xử lý */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InteractionsResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostLogs: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LogsRequest"];
            };
        };
        responses: {
            /** @description Đã lưu */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LogsResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayGetManifest: {
        parameters: {
            query?: {
                daypart?: string;
                etag?: string;
                delta?: "1";
            };
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
                "If-None-Match"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Manifest */
            200: {
                headers: {
                    ETag?: string;
                    "X-Manifest-Kind"?: "full" | "delta";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Manifest"] | components["schemas"]["ManifestDelta"];
                };
            };
            /** @description Không đổi */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayGetManifestGByGroup: {
        parameters: {
            query?: {
                etag?: string;
                delta?: "1";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Manifest */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Manifest"] | components["schemas"]["ManifestDelta"];
                };
            };
            /** @description Không đổi */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["Error"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostPair: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description paired=true hoặc mã mới */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PairResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostRegister: {
        parameters: {
            query?: never;
            header: {
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Đã đăng ký trước đó */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegisterResponse"];
                };
            };
            /** @description Thiết bị mới */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegisterResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayGetTaxAuthorization: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaxAuthResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostTaxAuthorization: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaxAuthRequest"];
            };
        };
        responses: {
            /** @description Đã ghi */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaxAuthResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostViewerPair: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ViewerPairRequest"];
            };
        };
        responses: {
            /** @description Đã ghép đôi */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ViewerPairResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostViewerPhone: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ViewerPhoneRequest"];
            };
        };
        responses: {
            /** @description Đã xác minh */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ViewerPhoneVerified"];
                };
            };
            /** @description Đã gửi OTP */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ViewerPhoneOtp"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayGetWallet: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WalletResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayGetWalletLedger: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
            };
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
    gatewayPostWithdraw: {
        parameters: {
            query?: never;
            header: {
                /** @description device_id từ /v1/register */
                "x-device-id": string;
                /** @description epoch giây; lệch máy chủ tối đa 300s */
                "x-timestamp": number;
                /** @description dùng một lần (chống phát lại) */
                "x-nonce": string;
                /** @description Ed25519, base64url không padding (64 byte) */
                "x-signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WithdrawRequest"];
            };
        };
        responses: {
            /** @description Lệnh cũ (idempotent) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WithdrawResponse"];
                };
            };
            /** @description Đã tạo lệnh chờ duyệt */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WithdrawResponse"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["RetryLater"];
            503: components["responses"]["RetryLater"];
        };
    };
}
