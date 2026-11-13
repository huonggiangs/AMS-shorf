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
}
