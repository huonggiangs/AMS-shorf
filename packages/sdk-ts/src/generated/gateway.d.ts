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
         * @description Thân tối đa 16 KB. Impression hợp lệ khi vcr_pct >= ngưỡng; sự kiện không có trong manifest bị từ chối từng cái (`rejected`).
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
         * @description Thân tối đa 2 KB. Trả khoảng nghỉ kế tiếp có jitter, etag manifest và lệnh đang chờ (giao at-least-once; xác nhận qua `cmd_ack` hoặc /v1/commands/ack). 429/503 kèm `Retry-After`.
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
         * @description Ký bằng chính khóa riêng tương ứng `pubkey` trong body (không có X-Device-Id). Trả `attestation_nonce` để kiểm chứng. Giới hạn theo IP.
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
            unknown: number;
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
                /** @description Ban dau: refresh_manifest, reboot, set_monitor. Type la: bo qua nhung VAN ack. */
                type: string;
                args?: {
                    [key: string]: unknown;
                };
            } & {
                [key: string]: unknown;
            })[];
            min_app_version?: string;
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
                /** @description hex; thiet bi PHAI kiem tra truoc khi phat */
                sha256: string;
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
            } & {
                [key: string]: unknown;
            })[];
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
                /** @description hex; thiet bi PHAI kiem tra truoc khi phat */
                sha256: string;
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
            } & {
                [key: string]: unknown;
            })[];
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
            } & {
                [key: string]: unknown;
            })[];
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
