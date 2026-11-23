/* Sinh tu docs/openapi/ams-admin-api.json bang packages/sdk-ts/scripts/generate.ts. KHONG sua tay. */
export interface paths {
    "/admin/v1/activation-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/activation-log
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetActivationLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/activation-log/{id}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/activation-log/{id}/undo
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostActivationLogByIdUndo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/approvals
         * @description Quyền cần có: mô-đun `approvals`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetApprovals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/audit-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/audit-log
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetAuditLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/billing/customers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/billing/customers/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBillingCustomersById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/billing/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/billing/events
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBillingEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/billing/receivables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/billing/receivables
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBillingReceivables"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/billing/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/billing/run
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostBillingRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/billing/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/billing/settings
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBillingSettings"];
        /**
         * PUT /admin/v1/billing/settings
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutBillingSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/billing/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/billing/summary
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBillingSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcast"];
        put?: never;
        /**
         * POST /admin/v1/broadcast
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostBroadcast"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast-insights/events/heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast-insights/events/heartbeat
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastInsightsEventsHeartbeat"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast-insights/events/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast-insights/events/logs
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastInsightsEventsLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast-insights/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast-insights/logs
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastInsightsLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast-insights/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast-insights/queue
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastInsightsQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast-insights/recommend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast-insights/recommend
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastInsightsRecommend"];
        put?: never;
        /**
         * POST /admin/v1/broadcast-insights/recommend
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostBroadcastInsightsRecommend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast-insights/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast-insights/summary
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastInsightsSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/devices-pick": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast/devices-pick
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastDevicesPick"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/notice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast/notice
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastNotice"];
        put?: never;
        /**
         * POST /admin/v1/broadcast/notice
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostBroadcastNotice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/notice/{batch}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast/notice/{batch}/status
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastNoticeByBatchStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastById"];
        /**
         * PUT /admin/v1/broadcast/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutBroadcastById"];
        post?: never;
        /**
         * DELETE /admin/v1/broadcast/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteBroadcastById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/{id}/delivery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast/{id}/delivery
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastByIdDelivery"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/broadcast/{id}/publish
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostBroadcastByIdPublish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/{id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/broadcast/{id}/unpublish
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostBroadcastByIdUnpublish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/broadcast/{id}/usb-package": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/broadcast/{id}/usb-package
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetBroadcastByIdUsbPackage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/campaigns
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetCampaigns"];
        put?: never;
        /**
         * POST /admin/v1/campaigns
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostCampaigns"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/campaigns/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetCampaignsById"];
        /**
         * PUT /admin/v1/campaigns/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutCampaignsById"];
        post?: never;
        /**
         * DELETE /admin/v1/campaigns/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteCampaignsById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/campaigns/{id}/approve
         * @description Quyền cần có: mô-đun `campaigns`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostCampaignsByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/campaigns/{id}/end
         * @description Quyền cần có: mô-đun `campaigns`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostCampaignsByIdEnd"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/campaigns/{id}/pause
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostCampaignsByIdPause"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/campaigns/{id}/quote
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetCampaignsByIdQuote"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/campaigns/{id}/reject
         * @description Quyền cần có: mô-đun `campaigns`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostCampaignsByIdReject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/campaigns/{id}/resume
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostCampaignsByIdResume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/reward-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/campaigns/{id}/reward-config
         * @description Quyền cần có: mô-đun `campaigns`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutCampaignsByIdRewardConfig"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/campaigns/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/campaigns/{id}/submit
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostCampaignsByIdSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/campaigns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/campaigns/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceCampaignsById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/campaigns/{id}/category": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/compliance/campaigns/{id}/category
         * @description Quyền cần có: mô-đun `campaigns`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutComplianceCampaignsByIdCategory"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/campaigns/{id}/second-approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/campaigns/{id}/second-approval
         * @description Quyền cần có: mô-đun `campaigns`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceCampaignsByIdSecondApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/consents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/consents
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceConsents"];
        put?: never;
        /**
         * POST /admin/v1/compliance/consents
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceConsents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/dsr": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/dsr
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceDsr"];
        put?: never;
        /**
         * POST /admin/v1/compliance/dsr
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceDsr"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/dsr/{id}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/dsr/{id}/execute
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceDsrByIdExecute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/dsr/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/dsr/{id}/reject
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceDsrByIdReject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/kyc
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceKyc"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/kyc/{customerId}
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceKycByCustomerId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/kyc/{customerId}/decision
         * @description Quyền cần có: mô-đun `customers`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceKycByCustomerIdDecision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}/documents/upload-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/kyc/{customerId}/documents/upload-url
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceKycByCustomerIdDocumentsUploadUrl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}/documents/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/kyc/{customerId}/documents/{id}/confirm
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceKycByCustomerIdDocumentsByIdConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}/documents/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/kyc/{customerId}/documents/{id}/review
         * @description Quyền cần có: mô-đun `customers`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceKycByCustomerIdDocumentsByIdReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/compliance/kyc/{customerId}/profile
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutComplianceKycByCustomerIdProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/kyc/{customerId}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/kyc/{customerId}/submit
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceKycByCustomerIdSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/processing-records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/processing-records
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceProcessingRecords"];
        put?: never;
        /**
         * POST /admin/v1/compliance/processing-records
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceProcessingRecords"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/processing-records/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/compliance/processing-records/{id}
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutComplianceProcessingRecordsById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/retention": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/compliance/retention
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetComplianceRetention"];
        /**
         * PUT /admin/v1/compliance/retention
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutComplianceRetention"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/compliance/retention/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/compliance/retention/run
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostComplianceRetentionRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/by-contract/{contractId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/by-contract/{contractId}
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsByContractByContractId"];
        put?: never;
        /**
         * POST /admin/v1/contract-docs/by-contract/{contractId}
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostContractDocsByContractByContractId"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/logo
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsLogo"];
        /**
         * PUT /admin/v1/contract-docs/logo
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutContractDocsLogo"];
        post?: never;
        /**
         * DELETE /admin/v1/contract-docs/logo
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteContractDocsLogo"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/logo/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/logo/image
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsLogoImage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/templates
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsTemplates"];
        put?: never;
        /**
         * POST /admin/v1/contract-docs/templates
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostContractDocsTemplates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/templates/import-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/contract-docs/templates/import-preview
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostContractDocsTemplatesImportPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/templates/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsTemplatesById"];
        /**
         * PUT /admin/v1/contract-docs/templates/{id}
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutContractDocsTemplatesById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/templates/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/contract-docs/templates/{id}/approve
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostContractDocsTemplatesByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/templates/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/templates/{id}/export
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsTemplatesByIdExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/variables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/variables
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsVariables"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsById"];
        /**
         * PUT /admin/v1/contract-docs/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutContractDocsById"];
        post?: never;
        /**
         * DELETE /admin/v1/contract-docs/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteContractDocsById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/{id}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/contract-docs/{id}/finalize
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostContractDocsByIdFinalize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/{id}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/{id}/pdf
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsByIdPdf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contract-docs/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contract-docs/{id}/preview
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractDocsByIdPreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contracts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contracts
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetContracts"];
        put?: never;
        /**
         * POST /admin/v1/contracts
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostContracts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contracts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contracts/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetContractsById"];
        /**
         * PUT /admin/v1/contracts/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutContractsById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contracts/{id}/lines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/contracts/{id}/lines
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetContractsByIdLines"];
        put?: never;
        /**
         * POST /admin/v1/contracts/{id}/lines
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostContractsByIdLines"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contracts/{id}/lines/{lineId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/contracts/{id}/lines/{lineId}
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutContractsByIdLinesByLineId"];
        post?: never;
        /**
         * DELETE /admin/v1/contracts/{id}/lines/{lineId}
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteContractsByIdLinesByLineId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/contracts/{id}/render": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/contracts/{id}/render
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostContractsByIdRender"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/customers
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetCustomers"];
        put?: never;
        /**
         * POST /admin/v1/customers
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostCustomers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/customers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/customers/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetCustomersById"];
        /**
         * PUT /admin/v1/customers/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutCustomersById"];
        post?: never;
        /**
         * DELETE /admin/v1/customers/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteCustomersById"];
        options?: never;
        head?: never;
        /**
         * PATCH /admin/v1/customers/{id}
         * @description Quyền cần có: mô-đun `customers`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        patch: operations["adminPatchCustomersById"];
        trace?: never;
    };
    "/admin/v1/dashboard/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/dashboard/overview
         * @description Quyền cần có: mô-đun `overview`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetDashboardOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/device-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/device-groups
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetDeviceGroups"];
        put?: never;
        /**
         * POST /admin/v1/device-groups
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDeviceGroups"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/device-groups/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/device-groups/assign
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutDeviceGroupsAssign"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/device-groups/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/device-groups/devices
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetDeviceGroupsDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/device-groups/devices/{deviceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * PATCH /admin/v1/device-groups/devices/{deviceId}
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        patch: operations["adminPatchDeviceGroupsDevicesByDeviceId"];
        trace?: never;
    };
    "/admin/v1/device-groups/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * DELETE /admin/v1/device-groups/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteDeviceGroupsById"];
        options?: never;
        head?: never;
        /**
         * PATCH /admin/v1/device-groups/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        patch: operations["adminPatchDeviceGroupsById"];
        trace?: never;
    };
    "/admin/v1/device-groups/{id}/volume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/device-groups/{id}/volume
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDeviceGroupsByIdVolume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/devices
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/devices/bulk
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesBulk"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/bulk-delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/devices/bulk-delete
         * @description Quyền cần có: mô-đun `devices`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesBulkDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/devices/pair
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesPair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/devices/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetDevicesById"];
        put?: never;
        post?: never;
        /**
         * DELETE /admin/v1/devices/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteDevicesById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/devices/{id}/approve
         * @description Quyền cần có: mô-đun `devices`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/devices/{id}/commands
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetDevicesByIdCommands"];
        put?: never;
        /**
         * POST /admin/v1/devices/{id}/commands
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesByIdCommands"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/commands/{cid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/devices/{id}/commands/{cid}
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetDevicesByIdCommandsByCid"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/commands/{cid}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/devices/{id}/commands/{cid}/cancel
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesByIdCommandsByCidCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/devices/{id}/logs
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetDevicesByIdLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/owner": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/devices/{id}/owner
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutDevicesByIdOwner"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/devices/{id}/revoke-approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/devices/{id}/revoke-approval
         * @description Quyền cần có: mô-đun `devices`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostDevicesByIdRevokeApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/einvoices
         * @description Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetEinvoices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/adjust": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/einvoices/adjust
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostEinvoicesAdjust"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/invoice/{invoiceId}/issue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/einvoices/invoice/{invoiceId}/issue
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostEinvoicesInvoiceByInvoiceIdIssue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/einvoices/settings
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetEinvoicesSettings"];
        /**
         * PUT /admin/v1/einvoices/settings
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutEinvoicesSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/einvoices/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetEinvoicesById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/einvoices/{id}/cancel
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostEinvoicesByIdCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/einvoices/{id}/confirm
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostEinvoicesByIdConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/{id}/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/einvoices/{id}/refresh
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostEinvoicesByIdRefresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/einvoices/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/einvoices/{id}/retry
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostEinvoicesByIdRetry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/history
         * @description Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/history/proof-of-play": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/history/proof-of-play
         * @description Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetHistoryProofOfPlay"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/history/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/history/{eventId}
         * @description Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetHistoryByEventId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/invoices
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetInvoices"];
        put?: never;
        /**
         * POST /admin/v1/invoices
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostInvoices"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/invoices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/invoices/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetInvoicesById"];
        /**
         * PUT /admin/v1/invoices/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutInvoicesById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/invoices/{id}/issue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/invoices/{id}/issue
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostInvoicesByIdIssue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/invoices/{id}/pay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/invoices/{id}/pay
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostInvoicesByIdPay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/invoices/{id}/void": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/invoices/{id}/void
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostInvoicesByIdVoid"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/layout-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/layout-templates
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLayoutTemplates"];
        put?: never;
        /**
         * POST /admin/v1/layout-templates
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostLayoutTemplates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/layout-templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/layout-templates/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLayoutTemplatesById"];
        /**
         * PUT /admin/v1/layout-templates/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutLayoutTemplatesById"];
        post?: never;
        /**
         * DELETE /admin/v1/layout-templates/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteLayoutTemplatesById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/legal/acceptances": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/legal/acceptances
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLegalAcceptances"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/legal/coverage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/legal/coverage
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLegalCoverage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/legal/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/legal/documents
         * @description Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLegalDocuments"];
        put?: never;
        /**
         * POST /admin/v1/legal/documents
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostLegalDocuments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/legal/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/legal/documents/{id}
         * @description Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLegalDocumentsById"];
        /**
         * PUT /admin/v1/legal/documents/{id}
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutLegalDocumentsById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/legal/documents/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/legal/documents/{id}/publish
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostLegalDocumentsByIdPublish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/legal/documents/{id}/retire": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/legal/documents/{id}/retire
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostLegalDocumentsByIdRetire"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/locations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/locations
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLocations"];
        put?: never;
        /**
         * POST /admin/v1/locations
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostLocations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/locations/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/locations/assign
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutLocationsAssign"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/locations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/locations/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetLocationsById"];
        put?: never;
        post?: never;
        /**
         * DELETE /admin/v1/locations/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteLocationsById"];
        options?: never;
        head?: never;
        /**
         * PATCH /admin/v1/locations/{id}
         * @description Quyền cần có: mô-đun `devices`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        patch: operations["adminPatchLocationsById"];
        trace?: never;
    };
    "/admin/v1/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/media
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/bulk-delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/bulk-delete
         * @description Quyền cần có: mô-đun `media`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostMediaBulkDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/import
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/link
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostMediaLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/scan-review/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/media/scan-review/queue
         * @description Quyền cần có: mô-đun `media`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetMediaScanReviewQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/upload-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/upload-url
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostMediaUploadUrl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/media/{id}
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetMediaById"];
        put?: never;
        post?: never;
        /**
         * DELETE /admin/v1/media/{id}
         * @description Quyền cần có: mô-đun `media`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteMediaById"];
        options?: never;
        head?: never;
        /**
         * PATCH /admin/v1/media/{id}
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        patch: operations["adminPatchMediaById"];
        trace?: never;
    };
    "/admin/v1/media/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/approve
         * @description Quyền cần có: mô-đun `media`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/confirm
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/media/{id}/content
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutMediaByIdContent"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/import/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/import/retry
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdImportRetry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/multipart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/multipart
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdMultipart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/multipart/abort": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/multipart/abort
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdMultipartAbort"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/multipart/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/multipart/complete
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdMultipartComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/overlay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/media/{id}/overlay
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutMediaByIdOverlay"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/parts/{n}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/media/{id}/parts/{n}
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutMediaByIdPartsByN"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/recheck": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/recheck
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdRecheck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/media/{id}/references
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetMediaByIdReferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/reject
         * @description Quyền cần có: mô-đun `media`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdReject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/scan-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/media/{id}/scan-review
         * @description Quyền cần có: mô-đun `media`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostMediaByIdScanReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/media/{id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/media/{id}/thumbnail
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetMediaByIdThumbnail"];
        /**
         * PUT /admin/v1/media/{id}/thumbnail
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutMediaByIdThumbnail"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/ops/incidents/{id}/ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/ops/incidents/{id}/ack
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostOpsIncidentsByIdAck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/ops/reencrypt-fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/ops/reencrypt-fields
         * @description Quyền cần có: mô-đun `admin`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostOpsReencryptFields"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/ops/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/ops/run
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostOpsRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/ops/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/ops/settings
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutOpsSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/ops/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/ops/summary
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetOpsSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/ops/test-notification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/ops/test-notification
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostOpsTestNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/partners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/partners
         * @description Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetPartners"];
        put?: never;
        /**
         * POST /admin/v1/partners
         * @description Quyền cần có: mô-đun `partners`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostPartners"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/partners/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/partners/{id}
         * @description Quyền cần có: mô-đun `partners`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetPartnersById"];
        /**
         * PUT /admin/v1/partners/{id}
         * @description Quyền cần có: mô-đun `partners`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutPartnersById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payments/manual-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/payments/manual-queue
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetPaymentsManualQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payments/manual-queue/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/payments/manual-queue/{id}/resolve
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostPaymentsManualQueueByIdResolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payouts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/payouts
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetPayouts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payouts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/payouts/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetPayoutsById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payouts/{id}/destination": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/payouts/{id}/destination
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetPayoutsByIdDestination"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payouts/{id}/pay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/payouts/{id}/pay
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostPayoutsByIdPay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/payouts/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/payouts/{id}/reject
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostPayoutsByIdReject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/permissions/{adminId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/permissions/{adminId}
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetPermissionsByAdminId"];
        /**
         * PUT /admin/v1/permissions/{adminId}
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutPermissionsByAdminId"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/pricing/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/pricing/quote
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetPricingQuote"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/rate-cards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/rate-cards
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetRateCards"];
        put?: never;
        /**
         * POST /admin/v1/rate-cards
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostRateCards"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/rate-cards/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/rate-cards/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetRateCardsById"];
        /**
         * PUT /admin/v1/rate-cards/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutRateCardsById"];
        post?: never;
        /**
         * DELETE /admin/v1/rate-cards/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteRateCardsById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/reconcile/repair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/reconcile/repair
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostReconcileRepair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/reconcile/revenue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/reconcile/revenue
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetReconcileRevenue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/reconcile/revenue/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/reconcile/revenue/run
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostReconcileRevenueRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/reconcile/revenue/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/reconcile/revenue/{id}/resolve
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostReconcileRevenueByIdResolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/reconcile/sepay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/reconcile/sepay
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostReconcileSepay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/refund-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/refund-requests
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetRefundRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/refund-requests/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/refund-requests/{id}/approve
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostRefundRequestsByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/refund-requests/{id}/paid": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/refund-requests/{id}/paid
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostRefundRequestsByIdPaid"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/refund-requests/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/refund-requests/{id}/reject
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostRefundRequestsByIdReject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/revenue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/revenue
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetRevenue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/revenue/hourly": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/revenue/hourly
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetRevenueHourly"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/rtb-floors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/rtb-floors
         * @description Quyền cần có: mô-đun `partners`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetRtbFloors"];
        put?: never;
        /**
         * POST /admin/v1/rtb-floors
         * @description Quyền cần có: mô-đun `partners`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostRtbFloors"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/rtb-floors/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/rtb-floors/{id}
         * @description Quyền cần có: mô-đun `partners`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutRtbFloorsById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/schedule
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetSchedule"];
        put?: never;
        /**
         * POST /admin/v1/schedule
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostSchedule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/schedule/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/schedule/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetScheduleById"];
        /**
         * PUT /admin/v1/schedule/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutScheduleById"];
        post?: never;
        /**
         * DELETE /admin/v1/schedule/{id}
         * @description Quyền cần có: mô-đun `schedule`, hành động `delete` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["adminDeleteScheduleById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/schedule/{id}/text": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/schedule/{id}/text
         * @description Quyền cần có: mô-đun `schedule`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutScheduleByIdText"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/screens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/screens
         * @description Quyền cần có: mô-đun `screens`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetScreens"];
        put?: never;
        /**
         * POST /admin/v1/screens
         * @description Quyền cần có: mô-đun `screens`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostScreens"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/screens/signage-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/screens/signage-config
         * @description Quyền cần có: mô-đun `screens`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetScreensSignageConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/screens/signage-config/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/screens/signage-config/{kind}
         * @description Quyền cần có: mô-đun `screens`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutScreensSignageConfigByKind"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/screens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/screens/{id}
         * @description Quyền cần có: mô-đun `screens`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetScreensById"];
        /**
         * PUT /admin/v1/screens/{id}
         * @description Quyền cần có: mô-đun `screens`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutScreensById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/settings/sepay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/settings/sepay
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetSettingsSepay"];
        /**
         * PUT /admin/v1/settings/sepay
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutSettingsSepay"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/settings/sepay/changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/settings/sepay/changes
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetSettingsSepayChanges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/settings/sepay/changes/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/settings/sepay/changes/{id}/approve
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostSettingsSepayChangesByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/settings/sepay/changes/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/settings/sepay/changes/{id}/reject
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostSettingsSepayChangesByIdReject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/settings/sepay/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/settings/sepay/test
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostSettingsSepayTest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/topups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/topups
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetTopups"];
        put?: never;
        /**
         * POST /admin/v1/topups
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostTopups"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/topups/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/topups/{id}/confirm
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostTopupsByIdConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/tv-experience": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/tv-experience
         * @description Quyền cần có: mô-đun `tv_experience`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetTvExperience"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/tv-experience/creatives": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/tv-experience/creatives
         * @description Quyền cần có: mô-đun `tv_experience`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetTvExperienceCreatives"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/tv-experience/creatives/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/tv-experience/creatives/{id}
         * @description Quyền cần có: mô-đun `tv_experience`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetTvExperienceCreativesById"];
        /**
         * PUT /admin/v1/tv-experience/creatives/{id}
         * @description Quyền cần có: mô-đun `tv_experience`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutTvExperienceCreativesById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/tv-experience/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /admin/v1/tv-experience/settings
         * @description Quyền cần có: mô-đun `tv_experience`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["adminPutTvExperienceSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/users
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetUsers"];
        put?: never;
        /**
         * POST /admin/v1/users
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        post: operations["adminPostUsers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/users/{id}
         * @description Quyền cần có: mô-đun `admin`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetUsersById"];
        /**
         * PUT /admin/v1/users/{id}
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        put: operations["adminPutUsersById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/users/{id}/resend-invite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/users/{id}/resend-invite
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostUsersByIdResendInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/users/{id}/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/users/{id}/reset-password
         * @description Quyền cần có: mô-đun `admin`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostUsersByIdResetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/wallet-adjustments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/wallet-adjustments
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["adminGetWalletAdjustments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/wallet-adjustments/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/wallet-adjustments/{id}/approve
         * @description Quyền cần có: mô-đun `finance`, hành động `approve` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostWalletAdjustmentsByIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/wallets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/wallets
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetWallets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/wallets/{customerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /admin/v1/wallets/{customerId}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         */
        get: operations["adminGetWalletsByCustomerId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/wallets/{customerId}/adjustments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /admin/v1/wallets/{customerId}/adjustments
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản nội bộ.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["adminPostWalletsByCustomerIdAdjustments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /auth/change-password
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["authPostChangePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/invite/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /auth/invite/accept
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["authPostInviteAccept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/invite/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /auth/invite/info
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["authGetInviteInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /auth/login */
        post: operations["authPostLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /auth/logout
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["authPostLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /auth/me */
        get: operations["authGetMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/mfa/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /auth/mfa/enroll */
        post: operations["authPostMfaEnroll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/mfa/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /auth/mfa/verify
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["authPostMfaVerify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/password/change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /auth/password/change
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["authPostPasswordChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /health
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["GetHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/legal/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /legal/documents
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["GetLegalDocuments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/legal/documents/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /legal/documents/{kind}
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["GetLegalDocumentsByKind"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ops/backup-report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /ops/backup-report
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["PostOpsBackupReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/campaigns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/campaigns
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetCampaigns"];
        put?: never;
        /**
         * POST /portal/v1/campaigns
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        post: operations["portalPostCampaigns"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/campaigns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/campaigns/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetCampaignsById"];
        /**
         * PUT /portal/v1/campaigns/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        put: operations["portalPutCampaignsById"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/campaigns/{id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/campaigns/{id}/pause
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostCampaignsByIdPause"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/campaigns/{id}/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/campaigns/{id}/quote
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetCampaignsByIdQuote"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/campaigns/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/campaigns/{id}/resume
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostCampaignsByIdResume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/campaigns/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/campaigns/{id}/submit
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostCampaignsByIdSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/einvoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/einvoices
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetEinvoices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/history
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/history/proof-of-play": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/history/proof-of-play
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetHistoryProofOfPlay"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/history/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/history/{eventId}
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetHistoryByEventId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/invoices
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetInvoices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/invoices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/invoices/{id}
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetInvoicesById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/kyc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/kyc
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetKyc"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/kyc/documents/upload-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/kyc/documents/upload-url
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostKycDocumentsUploadUrl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/kyc/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * DELETE /portal/v1/kyc/documents/{id}
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        delete: operations["portalDeleteKycDocumentsById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/kyc/documents/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/kyc/documents/{id}/confirm
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostKycDocumentsByIdConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/kyc/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /portal/v1/kyc/profile
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["portalPutKycProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/kyc/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/kyc/submit
         * @description Quyền cần có: mô-đun `campaigns`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostKycSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/legal/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/legal/accept
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostLegalAccept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/legal/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/legal/documents
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetLegalDocuments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/legal/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/legal/documents/{id}
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetLegalDocumentsById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/legal/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/legal/pending
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetLegalPending"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/me
         * @description Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/media
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/import
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/link
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        post: operations["portalPostMediaLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/upload-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/upload-url
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        post: operations["portalPostMediaUploadUrl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/media/{id}
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetMediaById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * PATCH /portal/v1/media/{id}
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        patch: operations["portalPatchMediaById"];
        trace?: never;
    };
    "/portal/v1/media/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/{id}/confirm
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaByIdConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /portal/v1/media/{id}/content
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["portalPutMediaByIdContent"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/import/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/{id}/import/retry
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaByIdImportRetry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/multipart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/{id}/multipart
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaByIdMultipart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/multipart/abort": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/{id}/multipart/abort
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaByIdMultipartAbort"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/multipart/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/{id}/multipart/complete
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaByIdMultipartComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/overlay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /portal/v1/media/{id}/overlay
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["portalPutMediaByIdOverlay"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/parts/{n}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * PUT /portal/v1/media/{id}/parts/{n}
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["portalPutMediaByIdPartsByN"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/recheck": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /portal/v1/media/{id}/recheck
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostMediaByIdRecheck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/media/{id}/references
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetMediaByIdReferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/media/{id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/media/{id}/thumbnail
         * @description Quyền cần có: mô-đun `media`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["portalGetMediaByIdThumbnail"];
        /**
         * PUT /portal/v1/media/{id}/thumbnail
         * @description Quyền cần có: mô-đun `media`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        put: operations["portalPutMediaByIdThumbnail"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/pricing/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/pricing/quote
         * @description Quyền cần có: mô-đun `campaigns`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetPricingQuote"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/topups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/topups
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetTopups"];
        put?: never;
        /**
         * POST /portal/v1/topups
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        post: operations["portalPostTopups"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/wallet": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/wallet
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetWallet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portal/v1/wallet/refund-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /portal/v1/wallet/refund-requests
         * @description Quyền cần có: mô-đun `finance`, hành động `view` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         */
        get: operations["portalGetWalletRefundRequests"];
        put?: never;
        /**
         * POST /portal/v1/wallet/refund-requests
         * @description Quyền cần có: mô-đun `finance`, hành động `write` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).
         *
         *     Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.
         *
         *     Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        post: operations["portalPostWalletRefundRequests"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * GET /status
         * @description Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.
         */
        get: operations["GetStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/payments/sepay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * POST /webhooks/payments/sepay
         * @description SePay gọi vào đây khi có giao dịch. Xác thực HMAC-SHA256 (`X-SePay-Signature: sha256=<hex>` + `X-SePay-Timestamp`, lệch >5 phút bị từ chối) hoặc `Authorization: Apikey <khóa>`. Trả `{"success":true}`; webhook trùng (cùng `id`) chỉ cộng tiền một lần.
         */
        post: operations["webhookPostPaymentsSepay"];
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
        ActivationLog: {
            items: ({
                id: string | number;
                customer_id?: string | null;
                trigger_topup_id?: string | null;
                /** @default [] */
                actions: unknown[];
                created_at?: string | null;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        AdminPatchDeviceGroupsByIdRequest: {
            [key: string]: unknown;
        };
        AdminPatchDeviceGroupsDevicesByDeviceIdRequest: {
            group_id?: string | null;
            location_id?: string | null;
            mac?: string | null;
            serial?: string | null;
            name?: string;
        };
        AdminPatchLocationsByIdRequest: {
            [key: string]: unknown;
        };
        AdminPatchMediaByIdRequest: {
            name?: string;
            description?: string | null;
            tags?: string[];
            duration_sec?: number;
            customer_id?: string;
            source_url?: string;
        };
        AdminPostBroadcastInsightsRecommendRequest: {
            /**
             * @default other
             * @enum {string}
             */
            place: "building" | "office" | "hospital" | "school" | "mall" | "restaurant" | "street" | "home" | "other";
            hour?: number;
            /**
             * @default mixed
             * @enum {string}
             */
            audience: "child" | "teen" | "adult" | "senior" | "mixed";
            /**
             * @default medium
             * @enum {string}
             */
            density: "low" | "medium" | "high";
            /**
             * @default any
             * @enum {string}
             */
            weather: "any" | "sunny" | "rain" | "hot" | "cold";
            /** @default  */
            note: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostBroadcastNoticeRequest: {
            text: string;
            /** @default 30 */
            duration_s: number;
            /**
             * @default all
             * @enum {string}
             */
            target: "all" | "tv" | "elevator" | "led_p5";
            /** @default [] */
            regions: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPostBroadcastRequest: {
            name: string;
            /** @enum {string} */
            target_type: "tv" | "elevator" | "led" | "led_p5";
            /** @default [] */
            regions: string[];
            start_date?: string | null;
            end_date?: string | null;
            /** @default 0 */
            start_min: number;
            /** @default 1440 */
            end_min: number;
            /** @default 3 */
            priority: number;
            header?: string | null;
            footer?: string | null;
            /** @default [] */
            creative_ids: string[];
            layout?: ({
                template_id?: string | null;
                /**
                 * @default landscape
                 * @enum {string}
                 */
                orientation: "landscape" | "portrait";
                zones: ({
                    id: string;
                    name?: string;
                    /** @enum {string} */
                    type: "video" | "image" | "marquee" | "text" | "clock" | "weather" | "qr";
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                    /** @default 0 */
                    z: number;
                    /**
                     * @default none
                     * @enum {string}
                     */
                    transition: "none" | "fade" | "slide-left" | "slide-right" | "zoom";
                    text?: string;
                    rich?: string;
                    bg_color?: string;
                    text_color?: string;
                    font_size?: number;
                    scroll_speed?: number;
                    /** @enum {string} */
                    scroll_dir?: "left" | "right";
                    clock?: {
                        hour12?: boolean;
                        tz?: string;
                        date?: boolean;
                    } & {
                        [key: string]: unknown;
                    };
                    url?: string;
                    qr?: {
                        /** @enum {string} */
                        mode: "image" | "url" | "vietqr";
                        value?: string;
                        vietqr?: {
                            bin: string;
                            account: string;
                            name?: string;
                            amount?: number;
                            memo?: string;
                            /** @enum {string} */
                            template?: "compact" | "compact2" | "qr_only" | "print";
                        } & {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    };
                    weather?: {
                        /** @enum {string} */
                        mode: "gps" | "fixed";
                        lat?: number;
                        lon?: number;
                        label?: string;
                    } & {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                })[];
            } & {
                [key: string]: unknown;
            }) | null;
            item_zones?: {
                [key: string]: string;
            };
            device_ids?: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPostCampaignsByIdRejectRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostCampaignsByIdSubmitRequest: {
            content_rights_confirmed?: boolean;
            restricted_industry?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostCampaignsRequest: {
            name: string;
            customer_id?: (unknown | string) | null;
            /**
             * @default tv
             * @enum {string}
             */
            screen_type: "tv" | "elevator" | "led";
            screen_id?: (unknown | string) | null;
            media_id?: (unknown | string) | null;
            budget_vnd: number;
            /** @default 15 */
            duration_sec: number;
            start_date?: (unknown | string) | null;
            end_date?: (unknown | string) | null;
            contract_id?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceCampaignsByIdSecondApprovalRequest: {
            note: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceConsentsRequest: {
            /** @enum {string} */
            subject_type: "customer_contact" | "end_user";
            subject_id: string;
            purpose: string;
            granted: boolean;
            version?: string;
            source?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceDsrByIdExecuteRequest: {
            confirm?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceDsrByIdRejectRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceDsrRequest: {
            /** @enum {string} */
            kind: "export" | "anonymize";
            /** @enum {string} */
            subject_type: "customer_contact" | "end_user";
            subject_id: string;
            requester?: string;
            channel?: string;
            note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceKycByCustomerIdDecisionRequest: {
            /** @enum {string} */
            decision: "approve" | "reject";
            note?: string;
            restricted_industry?: boolean;
            restricted_categories?: ("general" | "food_beverage" | "retail" | "real_estate" | "education" | "automotive" | "technology" | "entertainment" | "finance_banking" | "health_pharma" | "supplement" | "alcohol" | "tobacco" | "gambling" | "loan_credit" | "adult" | "political_religious")[];
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceKycByCustomerIdDocumentsByIdReviewRequest: {
            /** @enum {string} */
            decision: "approve" | "reject";
            note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceKycByCustomerIdDocumentsUploadUrlRequest: {
            /** @enum {string} */
            doc_type: "business_registration" | "industry_licence" | "ad_content_permit" | "authorization_letter" | "other";
            category?: string;
            file_name: string;
            content_type: string;
            size_bytes: number;
            expires_on?: string;
            note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostComplianceProcessingRecordsRequest: {
            activity: string;
            purpose: string;
            data_categories: string;
            data_subjects?: string;
            legal_basis?: string;
            recipients?: string;
            /** @default false */
            cross_border: boolean;
            retention?: string;
            owner?: string;
            /** @default true */
            active: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostContractDocsByContractByContractIdRequest: {
            template_id?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostContractDocsByIdFinalizeRequest: {
            content_hash?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostContractDocsTemplatesByIdApproveRequest: {
            /** @constant */
            confirm_lawyer_approved: true;
            lawyer_ref?: string;
            allow_draft_markers?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostContractDocsTemplatesRequest: {
            /** @default ads-service */
            code: string;
            name: string;
            articles: ({
                key: string;
                title: string;
                body: string;
                numbered?: boolean;
            } & {
                [key: string]: unknown;
            })[];
            change_note?: string;
            /** @enum {string} */
            import_source?: "docx" | "txt" | "md" | "html" | "json";
        } & {
            [key: string]: unknown;
        };
        AdminPostContractsByIdLinesRequest: {
            screen_type?: (unknown | ("tv" | "elevator" | "led_p5")) | null;
            region_id?: (unknown | string) | null;
            daypart?: (unknown | ("peak" | "off_peak")) | null;
            frequency?: (unknown | number) | null;
            duration_s?: (unknown | number) | null;
            /** @default 1 */
            qty: number;
            /**
             * @default fixed
             * @enum {string}
             */
            price_model: "fixed" | "cpm";
            price_micro_vnd?: number;
            impression_price_micro_vnd?: number;
            effective_from?: (unknown | string) | null;
            effective_to?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostContractsByIdRenderRequest: {
            advance_pct?: number;
            months?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPostContractsRequest: {
            customer_id: string;
            number?: (unknown | string) | null;
            title?: (unknown | string) | null;
            value_vnd: number;
            vat_rate?: number;
            start_date?: (unknown | string) | null;
            /** @default 12 */
            months: number;
            /** @default 0 */
            advance_pct: number;
            payment_terms?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostCustomersRequest: {
            legal_name: string;
            short_name?: string | null;
            tax_code?: string | null;
            address?: string | null;
            notes?: string | null;
            representative?: string | null;
            rep_title?: string | null;
            phone?: string | null;
            email?: string | null;
            contact?: string | null;
            industry?: string | null;
            payment_terms?: string | null;
            credit_limit_vnd?: number;
            owner_id?: string | null;
            /** @enum {string} */
            status?: "cooperating" | "suspended" | "pending_payment" | "terminated";
        } & {
            [key: string]: unknown;
        };
        AdminPostDeviceGroupsByIdVolumeRequest: {
            percent: number;
            /** @default true */
            include_children: boolean;
        };
        AdminPostDeviceGroupsRequest: {
            name: string;
            address?: string | null;
            province?: string | null;
            district?: string | null;
            lat?: number | null;
            lng?: number | null;
            /**
             * @default other
             * @enum {string}
             */
            venue_type: "supermarket" | "airport" | "elevator" | "fnb" | "hospital" | "hotel" | "other";
            contact_name?: string | null;
            contact_phone?: string | null;
            notes?: string | null;
            /**
             * @default active
             * @enum {string}
             */
            status: "active" | "inactive";
        };
        AdminPostDevicesBulkDeleteRequest: {
            ids: string[];
        };
        AdminPostDevicesBulkRequest: {
            /** @enum {string} */
            action: "verify" | "block" | "unblock";
            ids: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPostDevicesByIdApproveRequest: {
            screen_id?: string;
            venue_id?: string;
            name?: string;
        };
        AdminPostDevicesByIdCommandsRequest: {
            type: string;
            args?: {
                [key: string]: unknown;
            };
            ttl_s?: number;
            idempotency_key?: string;
        };
        AdminPostDevicesPairRequest: {
            code: string;
            owner_name?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostEinvoicesAdjustRequest: {
            invoice_id: string;
            refund_total_vnd: number;
            reason: string;
            refund_request_id?: string;
            manual_ref?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostEinvoicesByIdCancelRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostEinvoicesByIdConfirmRequest: {
            einvoice_no: string;
            series?: string;
            lookup_code?: string;
            issue_date?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostEinvoicesInvoiceByInvoiceIdIssueRequest: {
            manual_ref?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostInvoicesByIdIssueRequest: {
            einvoice_ref?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostInvoicesByIdPayRequest: {
            external_ref: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostInvoicesByIdVoidRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostInvoicesRequest: {
            customer_id: string;
            period: string;
            amount_vnd: number;
            vat_rate: number;
            allow_additional?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostLayoutTemplatesRequest: {
            name: string;
            /**
             * @default landscape
             * @enum {string}
             */
            orientation: "landscape" | "portrait";
            zones: ({
                id: string;
                name?: string;
                /** @enum {string} */
                type: "video" | "image" | "marquee" | "text" | "clock" | "weather" | "qr";
                x: number;
                y: number;
                w: number;
                h: number;
                /** @default 0 */
                z: number;
                /**
                 * @default none
                 * @enum {string}
                 */
                transition: "none" | "fade" | "slide-left" | "slide-right" | "zoom";
                text?: string;
                rich?: string;
                bg_color?: string;
                text_color?: string;
                font_size?: number;
                scroll_speed?: number;
                /** @enum {string} */
                scroll_dir?: "left" | "right";
                clock?: {
                    hour12?: boolean;
                    tz?: string;
                    date?: boolean;
                } & {
                    [key: string]: unknown;
                };
                url?: string;
                qr?: {
                    /** @enum {string} */
                    mode: "image" | "url" | "vietqr";
                    value?: string;
                    vietqr?: {
                        bin: string;
                        account: string;
                        name?: string;
                        amount?: number;
                        memo?: string;
                        /** @enum {string} */
                        template?: "compact" | "compact2" | "qr_only" | "print";
                    } & {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
                weather?: {
                    /** @enum {string} */
                    mode: "gps" | "fixed";
                    lat?: number;
                    lon?: number;
                    label?: string;
                } & {
                    [key: string]: unknown;
                };
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        AdminPostLegalDocumentsByIdPublishRequest: {
            /** @constant */
            confirm_lawyer_approved: true;
            lawyer_ref?: string;
            allow_draft_markers?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostLegalDocumentsRequest: {
            /** @enum {string} */
            kind: "terms" | "privacy" | "sla" | "ad_policy";
            version: string;
            title: string;
            body_md: string;
            /** @default true */
            requires_acceptance: boolean;
            change_note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostLocationsRequest: {
            name: string;
            address?: string | null;
            province?: string | null;
            district?: string | null;
            lat?: number | null;
            lng?: number | null;
            /**
             * @default other
             * @enum {string}
             */
            venue_type: "supermarket" | "airport" | "elevator" | "fnb" | "hospital" | "hotel" | "other";
            contact_name?: string | null;
            contact_phone?: string | null;
            notes?: string | null;
            /**
             * @default active
             * @enum {string}
             */
            status: "active" | "inactive";
        };
        AdminPostMediaBulkDeleteRequest: {
            ids: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaByIdApproveRequest: {
            content_version?: number;
            manual_review_note?: string;
            confirm_full_view?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaByIdConfirmRequest: {
            width?: number;
            height?: number;
            duration_sec?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaByIdMultipartCompleteRequest: {
            parts: ({
                n: number;
                etag: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaByIdRejectRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaByIdScanReviewRequest: {
            /** @enum {string} */
            decision: "approve" | "reject";
            note: string;
            content_version?: number;
            confirm_full_view?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaImportRequest: {
            /** @enum {string} */
            source: "youtube" | "drive" | "dropbox" | "url";
            url: string;
            name?: string;
            customer_id?: (unknown | string) | null;
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaLinkRequest: {
            url: string;
            name?: string;
            duration_sec: number;
            /** @enum {string} */
            kind?: "mp4" | "webm" | "hls" | "dash";
            /** @enum {string} */
            target_type?: "tv" | "elevator" | "led";
            width?: number;
            height?: number;
            customer_id?: (unknown | string) | null;
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaUploadUrlRequest: {
            name: string;
            content_type: string;
            size_bytes: number;
            width?: number;
            height?: number;
            duration_sec?: number;
            /** @enum {string} */
            target_type?: "tv" | "elevator" | "led";
            customer_id?: (unknown | string) | null;
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostOpsIncidentsByIdAckRequest: {
            note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostOpsReencryptFieldsRequest: {
            dry_run?: boolean;
            limit?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPostPartnersRequest: {
            name: string;
            protocol?: (unknown | string) | null;
            endpoint?: (unknown | string) | null;
            auth?: (unknown | string) | null;
            floor_cpm_vnd?: number;
            enabled?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPostPaymentsManualQueueByIdResolveRequest: {
            customer_id?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostPayoutsByIdPayRequest: {
            external_ref: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostPayoutsByIdRejectRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostRateCardsRequest: {
            /** @default * */
            customer_id: string;
            /**
             * @default *
             * @enum {string}
             */
            screen_type: "*" | "tv" | "elevator" | "led_p5";
            /** @default * */
            region_id: string;
            /**
             * @default *
             * @enum {string}
             */
            daypart: "*" | "peak" | "off_peak";
            /**
             * @default per_impression
             * @enum {string}
             */
            model: "per_impression" | "cpm";
            price_micro_vnd?: number;
            price_vnd?: string | number;
            floor_micro_vnd?: number;
            floor_vnd?: string | number;
            effective_from?: string;
            note?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostReconcileRepairRequest: {
            dryRun?: boolean;
            fixCacheFromLedger?: boolean;
            totp?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostReconcileRevenueByIdResolveRequest: {
            /** @enum {string} */
            status: "resolved" | "ignored";
            note: string;
            totp?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostReconcileRevenueRunRequest: {
            days?: number;
            campaign_id?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostRefundRequestsByIdApproveRequest: {
            note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostRefundRequestsByIdPaidRequest: {
            voucher_ref: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostRefundRequestsByIdRejectRequest: {
            note: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostRtbFloorsRequest: {
            category: string;
            floor_cpm_vnd: number;
        } & {
            [key: string]: unknown;
        };
        AdminPostScheduleRequest: {
            start_min: number;
            end_min: number;
            campaign_id: string;
            /** @default 3 */
            priority: number;
            /** @default 0 */
            reward_points: number;
            /** @default [] */
            regions: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPostScreensRequest: {
            name: string;
            /** @enum {string} */
            type: "elevator" | "led";
            /** @default Chung cư */
            venue_kind: string;
            size?: (unknown | string) | null;
            resolution: string;
            /** @default 1 */
            screens: number;
            region: string;
            address?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPostSettingsSepayChangesByIdApproveRequest: {
            totp?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostUsersByIdResetPasswordRequest: {
            password: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostUsersRequest: {
            name: string;
            /** Format: email */
            email: string;
            phone?: (unknown | string) | null;
            /** @enum {string} */
            role: "super_admin" | "content_manager" | "finance" | "device_ops" | "customer" | "partner";
            customer_id?: (unknown | string) | null;
            expires_at?: (unknown | string) | null;
            permissions?: {
                [key: string]: string[];
            };
        } & {
            [key: string]: unknown;
        };
        AdminPostWalletsByCustomerIdAdjustmentsRequest: {
            amount_vnd: number;
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPutBillingSettingsRequest: {
            reminder_offsets_days: number[];
            auto_pause_after_days: number;
            enforce_credit_limit: boolean;
            low_balance_email: boolean;
            send_emails: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPutBroadcastByIdRequest: {
            name?: string;
            /** @enum {string} */
            target_type?: "tv" | "elevator" | "led" | "led_p5";
            /** @default [] */
            regions: string[];
            start_date?: string | null;
            end_date?: string | null;
            /** @default 0 */
            start_min: number;
            /** @default 1440 */
            end_min: number;
            /** @default 3 */
            priority: number;
            header?: string | null;
            footer?: string | null;
            /** @default [] */
            creative_ids: string[];
            layout?: ({
                template_id?: string | null;
                /**
                 * @default landscape
                 * @enum {string}
                 */
                orientation: "landscape" | "portrait";
                zones: ({
                    id: string;
                    name?: string;
                    /** @enum {string} */
                    type: "video" | "image" | "marquee" | "text" | "clock" | "weather" | "qr";
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                    /** @default 0 */
                    z: number;
                    /**
                     * @default none
                     * @enum {string}
                     */
                    transition: "none" | "fade" | "slide-left" | "slide-right" | "zoom";
                    text?: string;
                    rich?: string;
                    bg_color?: string;
                    text_color?: string;
                    font_size?: number;
                    scroll_speed?: number;
                    /** @enum {string} */
                    scroll_dir?: "left" | "right";
                    clock?: {
                        hour12?: boolean;
                        tz?: string;
                        date?: boolean;
                    } & {
                        [key: string]: unknown;
                    };
                    url?: string;
                    qr?: {
                        /** @enum {string} */
                        mode: "image" | "url" | "vietqr";
                        value?: string;
                        vietqr?: {
                            bin: string;
                            account: string;
                            name?: string;
                            amount?: number;
                            memo?: string;
                            /** @enum {string} */
                            template?: "compact" | "compact2" | "qr_only" | "print";
                        } & {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    };
                    weather?: {
                        /** @enum {string} */
                        mode: "gps" | "fixed";
                        lat?: number;
                        lon?: number;
                        label?: string;
                    } & {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                })[];
            } & {
                [key: string]: unknown;
            }) | null;
            item_zones?: {
                [key: string]: string;
            };
            device_ids?: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPutCampaignsByIdRequest: {
            name?: string;
            customer_id?: (unknown | string) | null;
            /**
             * @default tv
             * @enum {string}
             */
            screen_type: "tv" | "elevator" | "led";
            screen_id?: (unknown | string) | null;
            media_id?: (unknown | string) | null;
            budget_vnd?: number;
            /** @default 15 */
            duration_sec: number;
            start_date?: (unknown | string) | null;
            end_date?: (unknown | string) | null;
            contract_id?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPutCampaignsByIdRewardConfigRequest: {
            /** @enum {string} */
            reward_model: "cover" | "performance";
            interaction_reward_vnd: number;
        } & {
            [key: string]: unknown;
        };
        AdminPutComplianceCampaignsByIdCategoryRequest: {
            /** @enum {string} */
            category: "general" | "food_beverage" | "retail" | "real_estate" | "education" | "automotive" | "technology" | "entertainment" | "finance_banking" | "health_pharma" | "supplement" | "alcohol" | "tobacco" | "gambling" | "loan_credit" | "adult" | "political_religious";
        } & {
            [key: string]: unknown;
        };
        AdminPutComplianceKycByCustomerIdProfileRequest: {
            business_reg_no?: string | null;
            business_reg_date?: string | null;
            business_reg_place?: string | null;
            legal_rep_name?: string | null;
            legal_rep_title?: string | null;
        } & {
            [key: string]: unknown;
        };
        AdminPutComplianceProcessingRecordsByIdRequest: {
            activity: string;
            purpose: string;
            data_categories: string;
            data_subjects?: string;
            legal_basis?: string;
            recipients?: string;
            /** @default false */
            cross_border: boolean;
            retention?: string;
            owner?: string;
            /** @default true */
            active: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPutComplianceRetentionRequest: {
            ev_heartbeat_days: number;
            ev_ad_impression_days: number;
            ev_proof_of_play_days: number;
            impression_hourly_days: number;
        } & {
            [key: string]: unknown;
        };
        AdminPutContractDocsByIdRequest: {
            variables?: {
                [key: string]: string;
            };
            article_overrides?: {
                [key: string]: {
                    title?: string;
                    body?: string;
                } & {
                    [key: string]: unknown;
                };
            };
        } & {
            [key: string]: unknown;
        };
        AdminPutContractDocsLogoRequest: {
            /** @enum {string} */
            content_type: "image/png" | "image/jpeg";
            data_base64: string;
        } & {
            [key: string]: unknown;
        };
        AdminPutContractDocsTemplatesByIdRequest: {
            name?: string;
            articles?: ({
                key: string;
                title: string;
                body: string;
                numbered?: boolean;
            } & {
                [key: string]: unknown;
            })[];
            change_note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPutContractsByIdLinesByLineIdRequest: {
            screen_type?: (unknown | ("tv" | "elevator" | "led_p5")) | null;
            region_id?: (unknown | string) | null;
            daypart?: (unknown | ("peak" | "off_peak")) | null;
            frequency?: (unknown | number) | null;
            duration_s?: (unknown | number) | null;
            /** @default 1 */
            qty: number;
            /**
             * @default fixed
             * @enum {string}
             */
            price_model: "fixed" | "cpm";
            price_micro_vnd?: number;
            impression_price_micro_vnd?: number;
            effective_from?: (unknown | string) | null;
            effective_to?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPutContractsByIdRequest: {
            title?: string;
            value_vnd?: number;
            vat_rate?: number;
            start_date?: string;
            end_date?: string;
            advance_pct?: number;
            payment_terms?: string;
            /** @enum {string} */
            status?: "pending_sign" | "effective" | "suspended" | "expired" | "terminated" | "draft";
        } & {
            [key: string]: unknown;
        };
        AdminPutDeviceGroupsAssignRequest: {
            device_ids: string[];
            location_id: string | null;
        };
        AdminPutDevicesByIdOwnerRequest: {
            owner_name: string;
        };
        AdminPutEinvoicesSettingsRequest: {
            /** @enum {string} */
            provider: "manual" | "misa" | "viettel";
            sandbox: boolean;
            /** @default  */
            series: string;
            /** @default  */
            template_code: string;
            /** @default false */
            auto_issue: boolean;
            /** @default true */
            auto_adjust_on_refund: boolean;
            confirm_production?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPutInvoicesByIdRequest: {
            amount_vnd?: number;
            vat_rate?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPutLayoutTemplatesByIdRequest: {
            name?: string;
            /**
             * @default landscape
             * @enum {string}
             */
            orientation: "landscape" | "portrait";
            zones?: ({
                id: string;
                name?: string;
                /** @enum {string} */
                type: "video" | "image" | "marquee" | "text" | "clock" | "weather" | "qr";
                x: number;
                y: number;
                w: number;
                h: number;
                /** @default 0 */
                z: number;
                /**
                 * @default none
                 * @enum {string}
                 */
                transition: "none" | "fade" | "slide-left" | "slide-right" | "zoom";
                text?: string;
                rich?: string;
                bg_color?: string;
                text_color?: string;
                font_size?: number;
                scroll_speed?: number;
                /** @enum {string} */
                scroll_dir?: "left" | "right";
                clock?: {
                    hour12?: boolean;
                    tz?: string;
                    date?: boolean;
                } & {
                    [key: string]: unknown;
                };
                url?: string;
                qr?: {
                    /** @enum {string} */
                    mode: "image" | "url" | "vietqr";
                    value?: string;
                    vietqr?: {
                        bin: string;
                        account: string;
                        name?: string;
                        amount?: number;
                        memo?: string;
                        /** @enum {string} */
                        template?: "compact" | "compact2" | "qr_only" | "print";
                    } & {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
                weather?: {
                    /** @enum {string} */
                    mode: "gps" | "fixed";
                    lat?: number;
                    lon?: number;
                    label?: string;
                } & {
                    [key: string]: unknown;
                };
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        AdminPutLegalDocumentsByIdRequest: {
            title?: string;
            body_md?: string;
            /** @default true */
            requires_acceptance: boolean;
            change_note?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPutLocationsAssignRequest: {
            device_ids: string[];
            location_id: string | null;
        };
        AdminPutMediaByIdOverlayRequest: {
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPutOpsSettingsRequest: {
            emails?: string[];
            webhook_url?: string | null;
        } & {
            [key: string]: unknown;
        };
        AdminPutPartnersByIdRequest: {
            name?: string;
            protocol?: (unknown | string) | null;
            endpoint?: (unknown | string) | null;
            auth?: (unknown | string) | null;
            floor_cpm_vnd?: number;
            enabled?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPutPermissionsByAdminIdRequest: {
            permissions: {
                [key: string]: string[];
            };
        } & {
            [key: string]: unknown;
        };
        AdminPutRateCardsByIdRequest: {
            /**
             * @default per_impression
             * @enum {string}
             */
            model: "per_impression" | "cpm";
            price_micro_vnd?: number;
            price_vnd?: string | number;
            floor_micro_vnd?: number;
            floor_vnd?: string | number;
            effective_from?: string;
            note?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        AdminPutRtbFloorsByIdRequest: {
            floor_cpm_vnd: number;
        } & {
            [key: string]: unknown;
        };
        AdminPutScheduleByIdRequest: {
            start_min?: number;
            end_min?: number;
            priority?: number;
            reward_points?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPutScheduleByIdTextRequest: {
            header?: string | null;
            footer?: string | null;
        };
        AdminPutScreensByIdRequest: {
            name?: string;
            region?: string;
            address?: string;
            /** @enum {string} */
            status?: "online" | "checking" | "needs_update" | "offline";
        } & {
            [key: string]: unknown;
        };
        AdminPutSettingsSepayRequest: {
            enabled?: boolean;
            /** @enum {string} */
            bank?: "Vietcombank" | "VietinBank" | "BIDV" | "Agribank" | "MBBank" | "Techcombank" | "ACB" | "VPBank" | "TPBank" | "Sacombank" | "HDBank" | "OCB" | "MSB" | "SHB" | "VIB" | "SeABank";
            account_number?: string;
            account_holder?: string;
            prefix?: string;
            min_activate_vnd?: number;
            auto_activate?: boolean;
            daily_limit_vnd?: number;
            api_key?: "" | string;
            webhook_secret?: "" | string;
            /** @enum {string} */
            auth_mode?: "hmac" | "apikey";
            totp?: string;
        } & {
            [key: string]: unknown;
        };
        AdminPutTvExperienceCreativesByIdRequest: {
            contexts?: ("lock" | "fullscreen" | "pause" | "corner")[];
            duration_s?: number;
            safe_area?: {
                top: number;
                right: number;
                bottom: number;
                left: number;
            } & {
                [key: string]: unknown;
            };
            kid_safe?: boolean;
            confirm_reviewed?: boolean;
            note?: string;
        };
        AdminPutTvExperienceSettingsRequest: {
            lock_ads_enabled: boolean;
            fullscreen_ads_enabled: boolean;
            frequency: {
                per_hour: number;
                min_gap_s: number;
                same_creative_gap_s: number;
            } & {
                [key: string]: unknown;
            };
            banned_industries: string[];
            confirm_children_policy?: boolean;
        } & {
            [key: string]: unknown;
        };
        AdminPutUsersByIdRequest: {
            name?: string;
            phone?: string | null;
            /** @enum {string} */
            role?: "super_admin" | "content_manager" | "finance" | "device_ops" | "customer" | "partner";
            customer_id?: string | null;
            expires_at?: string | null;
            /** @enum {string} */
            status?: "active" | "locked";
        } & {
            [key: string]: unknown;
        };
        AdminUser: {
            id: string | number;
            name?: string | null;
            email: string;
            phone?: string | null;
            role: string;
            customer_id?: string | null;
            customer_name?: string | null;
            status: string;
            expires_at?: string | null;
            perm_count?: number;
        } & {
            [key: string]: unknown;
        };
        AdminUserPage: {
            items: components["schemas"]["AdminUser"][];
            total: number;
            page: number;
            page_size: number;
        };
        ApproveResult: {
            status: string;
            /** @default 0 */
            reserved_vnd: number;
            /** @default 0 */
            shortfall_vnd: number;
            message?: string;
        } & {
            [key: string]: unknown;
        };
        AuditEntry: {
            id: string | number;
            at: string;
            actor?: string | null;
            action: string;
            object?: string | null;
            ip?: string | null;
        } & {
            [key: string]: unknown;
        };
        AuditEntryPage: {
            items: components["schemas"]["AuditEntry"][];
            total: number;
            page: number;
            page_size: number;
        };
        AuthPostInviteAcceptRequest: {
            token: string;
            password: string;
        } & {
            [key: string]: unknown;
        };
        AuthPostLoginRequest: {
            email: string;
            password: string;
        } & {
            [key: string]: unknown;
        };
        AuthPostMfaEnrollRequest: {
            mfa_token?: string;
        } & {
            [key: string]: unknown;
        };
        AuthPostMfaVerifyRequest: {
            mfa_token?: string;
            code: string;
        } & {
            [key: string]: unknown;
        };
        Campaign: {
            id: string | number;
            name: string;
            customer_id?: string | null;
            brand?: string | null;
            status: string;
            screen_type?: string | null;
            duration_sec?: number | null;
            /** @default 0 */
            budget_vnd: number;
            /** @default 0 */
            reserved_vnd: number;
            start_date?: string | null;
            end_date?: string | null;
            /** @default 0 */
            impressions: number;
            target_impressions?: number | null;
            source?: string | null;
            creator?: string | null;
            media_id?: string | null;
            media_name?: string | null;
            pacing_pct?: number | null;
            reward_per_view?: number | null;
            /** @enum {string} */
            reward_model?: "cover" | "performance";
            interaction_reward_vnd?: number;
            reject_reason?: string | null;
            restricted_industry?: boolean;
            restricted_reason?: string | null;
            customer_industry?: string | null;
            content_rights_confirmed?: boolean;
            content_rights_confirmed_at?: string | null;
            content_rights_confirmed_by?: string | null;
        } & {
            [key: string]: unknown;
        };
        CampaignPage: {
            items: components["schemas"]["Campaign"][];
            total: number;
            page: number;
            page_size: number;
        };
        Contract: {
            id: string | number;
            number: string;
            customer_id: string;
            customer_name?: string | null;
            title?: string | null;
            /** @default 0 */
            value_vnd: number;
            start_date?: string | null;
            end_date?: string | null;
            /** @default 0 */
            paid_pct: number;
            status: string;
        } & {
            [key: string]: unknown;
        };
        ContractPage: {
            items: components["schemas"]["Contract"][];
            total: number;
            page: number;
            page_size: number;
        };
        ContractRender: {
            html: string;
            amount_in_words?: string;
        } & {
            [key: string]: unknown;
        };
        Customer: {
            id: string | number;
            code?: string | null;
            legal_name: string;
            short_name?: string | null;
            tax_code?: string | null;
            address?: string | null;
            representative?: string | null;
            rep_title?: string | null;
            phone?: string | null;
            email?: string | null;
            contact?: string | null;
            industry?: string | null;
            owner?: string | null;
            payment_terms?: string | null;
            /** @default 0 */
            credit_limit_vnd: number;
            /** @default 0 */
            debt_vnd: number;
            status: string;
            since?: string | null;
            notes?: string | null;
            updated_at?: string | null;
        } & {
            [key: string]: unknown;
        };
        CustomerPage: {
            items: components["schemas"]["Customer"][];
            total: number;
            page: number;
            page_size: number;
        };
        Device: {
            id: string | number;
            name: string;
            kind?: string | null;
            model?: string | null;
            os?: string | null;
            owner_name?: string | null;
            app_version?: string | null;
            region?: string | null;
            status: string;
            last_seen_at?: string | null;
            /** @default 0 */
            views: number;
            recent_ads?: string[];
            grant_state?: string | null;
            play_source?: string | null;
            cache_mb?: number | null;
            px_w?: number | null;
            px_h?: number | null;
            orientation?: string | null;
            approved_at?: string | null;
            screen?: ({
                id: string;
                venue_id?: string | null;
                venue_name?: string | null;
            } & {
                [key: string]: unknown;
            }) | null;
        } & {
            [key: string]: unknown;
        };
        DevicePage: {
            items: components["schemas"]["Device"][];
            total: number;
            page: number;
            page_size: number;
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
        GenericObject: {
            [key: string]: unknown;
        };
        LoginResult: {
            /** @default false */
            mfa_required: boolean;
            mfa_token?: string;
            mfa_enroll_required?: boolean;
            csrf_token?: string;
        } & {
            [key: string]: unknown;
        };
        ManualQueue: {
            items: ({
                id: string | number;
                event_id?: string | null;
                reason: string;
                customer_id?: string | null;
                topup_id?: string | null;
                received_at?: string | null;
                /** @default 0 */
                amount_vnd: number;
                content?: string | null;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        Me: {
            user: {
                id: string | number;
                email: string;
                name?: string | null;
                role: string;
                customer_id?: string | null;
                mfa_enabled?: boolean;
                last_login_at?: string | null;
            } & {
                [key: string]: unknown;
            };
            /** @default {} */
            permissions: {
                [key: string]: string[];
            };
            customer_scope?: ({
                customer_id: string;
                code?: string | null;
                name?: string | null;
                campaign_grants?: string[];
            } & {
                [key: string]: unknown;
            }) | null;
            dev_mode?: boolean;
            csrf_token?: string;
            must_change_password?: boolean;
        } & {
            [key: string]: unknown;
        };
        Media: {
            id: string | number;
            name: string;
            kind?: string | null;
            mime?: string | null;
            width?: number | null;
            height?: number | null;
            duration_sec?: number | null;
            size_bytes?: number | null;
            status: string;
            owner_name?: string | null;
            source_url?: string | null;
            thumb_url?: string | null;
            source?: string | null;
            reject_reason?: string | null;
            format?: string | null;
            sha256?: string | null;
            overlay?: unknown;
            scan_state?: string | null;
            /** @default [] */
            scan_reasons: string[];
            /** @default 1 */
            content_version: number;
            preview_url?: string | null;
            description?: string | null;
            /** @default [] */
            tags: string[];
            customer_id?: string | null;
            customer_code?: string | null;
            campaign_id?: string | null;
            blocker?: ({
                code: string;
                message: string;
                action: string;
            } & {
                [key: string]: unknown;
            }) | null;
            transfer?: ({
                kind: string;
                status: string;
                /** @default 0 */
                bytes_done: number;
                bytes_total?: number | null;
                percent?: number | null;
                parts_done?: number | null;
                total_parts?: number | null;
                error_code?: string | null;
                error_message?: string | null;
            } & {
                [key: string]: unknown;
            }) | null;
            created_at?: string | null;
            /** @default [] */
            warnings: string[];
            diag?: ({
                code?: string;
                http?: number | null;
                content_type?: string | null;
                title?: string | null;
                snippet?: string | null;
                final_url?: string | null;
            } & {
                [key: string]: unknown;
            }) | null;
            delivery?: string | null;
            stream?: ({
                delivery?: string;
                stream_url: string;
                stream_host?: string;
                stream_kind: string;
                declared_duration_s: number;
                /** @default ok */
                probe_status: string;
                /** @default false */
                needs_review: boolean;
                content_type?: string | null;
                content_length?: number | null;
                etag?: string | null;
                last_modified?: string | null;
                checked_at?: string | null;
                info?: ({
                    codec?: string | null;
                    audio_codec?: string | null;
                    width?: number | null;
                    height?: number | null;
                    duration_s?: number | null;
                    fps?: number | null;
                    resolution_label?: string | null;
                } & {
                    [key: string]: unknown;
                }) | null;
                /** @default [] */
                warnings: ({
                    code?: string;
                    message: string;
                } & {
                    [key: string]: unknown;
                })[];
                reason?: string | null;
            } & {
                [key: string]: unknown;
            }) | null;
        } & {
            [key: string]: unknown;
        };
        MediaBulkDeleteResult: {
            requested: number;
            deleted_count: number;
            skipped_count: number;
            freed_bytes: number;
            objects_deleted?: number;
            deleted: ({
                id: string | number;
                name?: string | null;
                size_bytes?: number | null;
            } & {
                [key: string]: unknown;
            })[];
            skipped: ({
                id: string | number;
                name?: string | null;
                code: string;
                reason: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        MediaPage: {
            items: components["schemas"]["Media"][];
            total: number;
            page: number;
            page_size: number;
        };
        MfaEnroll: {
            secret: string;
            otpauth_url?: string;
            qr_url?: string;
            mfa_token?: string;
        } & {
            [key: string]: unknown;
        };
        Overview: {
            /** @default {} */
            kpi: {
                [key: string]: number | string;
            };
            /** @default [] */
            trend: ({
                label: string;
                views: number;
                revenue_vnd: number;
            } & {
                [key: string]: unknown;
            })[];
            /** @default [] */
            revenue_split: ({
                name: string;
                value: number;
            } & {
                [key: string]: unknown;
            })[];
            /** @default [] */
            slot_fill: ({
                day: string;
                values: number[];
            } & {
                [key: string]: unknown;
            })[];
            /** @default [] */
            alerts: ({
                level: string;
                title: string;
                text?: string;
            } & {
                [key: string]: unknown;
            })[];
            /** @default [] */
            top_campaigns: ({
                id: string | number;
                name: string;
                customer_id?: string | null;
                brand?: string | null;
                status: string;
                screen_type?: string | null;
                duration_sec?: number | null;
                /** @default 0 */
                budget_vnd: number;
                /** @default 0 */
                reserved_vnd: number;
                start_date?: string | null;
                end_date?: string | null;
                /** @default 0 */
                impressions: number;
                target_impressions?: number | null;
                source?: string | null;
                creator?: string | null;
                media_id?: string | null;
                media_name?: string | null;
                pacing_pct?: number | null;
                reward_per_view?: number | null;
                /** @enum {string} */
                reward_model?: "cover" | "performance";
                interaction_reward_vnd?: number;
                reject_reason?: string | null;
                restricted_industry?: boolean;
                restricted_reason?: string | null;
                customer_industry?: string | null;
                content_rights_confirmed?: boolean;
                content_rights_confirmed_at?: string | null;
                content_rights_confirmed_by?: string | null;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        Partner: {
            id: string | number;
            name: string;
            protocol?: string | null;
            status: string;
            enabled?: boolean;
            /** @default 0 */
            ecpm_vnd: number;
            fill_rate?: number | null;
            endpoint?: string | null;
            auth?: string | null;
        } & {
            [key: string]: unknown;
        };
        PartnerPage: {
            items: components["schemas"]["Partner"][];
            total: number;
            page: number;
            page_size: number;
        };
        PortalPatchMediaByIdRequest: {
            name?: string;
            description?: string | null;
            tags?: string[];
            duration_sec?: number;
            customer_id?: string;
            source_url?: string;
        };
        PortalPostCampaignsByIdSubmitRequest: {
            content_rights_confirmed?: boolean;
            restricted_industry?: boolean;
        } & {
            [key: string]: unknown;
        };
        PortalPostCampaignsRequest: {
            name: string;
            customer_id?: (unknown | string) | null;
            /**
             * @default tv
             * @enum {string}
             */
            screen_type: "tv" | "elevator" | "led";
            screen_id?: (unknown | string) | null;
            media_id?: (unknown | string) | null;
            budget_vnd: number;
            /** @default 15 */
            duration_sec: number;
            start_date?: (unknown | string) | null;
            end_date?: (unknown | string) | null;
            contract_id?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        PortalPostKycDocumentsUploadUrlRequest: {
            /** @enum {string} */
            doc_type: "business_registration" | "industry_licence" | "ad_content_permit" | "authorization_letter" | "other";
            category?: string;
            file_name: string;
            content_type: string;
            size_bytes: number;
            expires_on?: string;
            note?: string;
        } & {
            [key: string]: unknown;
        };
        PortalPostLegalAcceptRequest: {
            acceptances: ({
                document_id: string;
                sha256: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        PortalPostMediaByIdConfirmRequest: {
            width?: number;
            height?: number;
            duration_sec?: number;
        } & {
            [key: string]: unknown;
        };
        PortalPostMediaByIdMultipartCompleteRequest: {
            parts: ({
                n: number;
                etag: string;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        PortalPostMediaImportRequest: {
            /** @enum {string} */
            source: "youtube" | "drive" | "dropbox" | "url";
            url: string;
            name?: string;
            customer_id?: (unknown | string) | null;
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        PortalPostMediaLinkRequest: {
            url: string;
            name?: string;
            duration_sec: number;
            /** @enum {string} */
            kind?: "mp4" | "webm" | "hls" | "dash";
            /** @enum {string} */
            target_type?: "tv" | "elevator" | "led";
            width?: number;
            height?: number;
            customer_id?: (unknown | string) | null;
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        PortalPostMediaUploadUrlRequest: {
            name: string;
            content_type: string;
            size_bytes: number;
            width?: number;
            height?: number;
            duration_sec?: number;
            /** @enum {string} */
            target_type?: "tv" | "elevator" | "led";
            customer_id?: (unknown | string) | null;
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        PortalPostWalletRefundRequestsRequest: {
            amount_vnd: number;
            reason?: string;
        } & {
            [key: string]: unknown;
        };
        PortalPutCampaignsByIdRequest: {
            name?: string;
            customer_id?: (unknown | string) | null;
            /**
             * @default tv
             * @enum {string}
             */
            screen_type: "tv" | "elevator" | "led";
            screen_id?: (unknown | string) | null;
            media_id?: (unknown | string) | null;
            budget_vnd?: number;
            /** @default 15 */
            duration_sec: number;
            start_date?: (unknown | string) | null;
            end_date?: (unknown | string) | null;
            contract_id?: (unknown | string) | null;
        } & {
            [key: string]: unknown;
        };
        PortalPutKycProfileRequest: {
            business_reg_no?: string | null;
            business_reg_date?: string | null;
            business_reg_place?: string | null;
            legal_rep_name?: string | null;
            legal_rep_title?: string | null;
        } & {
            [key: string]: unknown;
        };
        PortalPutMediaByIdOverlayRequest: {
            format?: string;
            overlay?: (unknown | unknown) | null;
        } & {
            [key: string]: unknown;
        };
        PortalWallet: {
            /** @default 0 */
            balance_vnd: number;
            /** @default 0 */
            reserved_vnd: number;
            /** @default 0 */
            spent_vnd: number;
            /** @default 0 */
            available_vnd: number;
            payment?: ({
                bank: string;
                account_number: string;
                account_holder: string;
                /** @default AMS */
                prefix: string;
            } & {
                [key: string]: unknown;
            }) | null;
        } & {
            [key: string]: unknown;
        };
        PostOpsBackupReportRequest: {
            /** @enum {string} */
            kind: "d1" | "postgres" | "media";
            env?: string;
            target?: string;
            bytes?: number;
            sha256?: string;
            encrypted?: boolean;
            ok: boolean;
            note?: string;
            started_at?: string;
            finished_at?: string;
        } & {
            [key: string]: unknown;
        };
        Quote: {
            status: string;
            /** @default false */
            locked: boolean;
            /** @default false */
            placeholder: boolean;
            budget_vnd?: number | null;
            message?: string | null;
            /** @default [] */
            lines: ({
                screen_type: string;
                region_id: string;
                daypart: string;
                unit_price_micro_vnd: number;
                unit_price_vnd: string;
                model?: string | null;
                estimated_impressions?: number | null;
                floor_micro_vnd?: number | null;
                source?: string | null;
                floored?: boolean | null;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        RateCard: {
            id: string | number;
            customer_id: string;
            customer_name?: string | null;
            screen_type: string;
            region_id: string;
            daypart: string;
            model: string;
            price_micro_vnd: number;
            price_vnd: string;
            floor_micro_vnd: number;
            floor_vnd: string;
            effective_from: string;
            effective_to?: string | null;
            status: string;
            note?: string | null;
        } & {
            [key: string]: unknown;
        };
        RateCardPage: {
            items: components["schemas"]["RateCard"][];
            total: number;
            page: number;
            page_size: number;
        };
        RefundRequests: {
            items: ({
                id: string | number;
                customer_id: string;
                customer_name?: string | null;
                /** @default 0 */
                amount_vnd: number;
                reason?: string | null;
                status: string;
                decision_note?: string | null;
                created_at?: string | null;
                decided_at?: string | null;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        Revenue: {
            /** @default [] */
            months: ({
                label: string;
                revenue_vnd: number;
                reward_vnd: number;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        RtbFloor: {
            id: string | number;
            category: string;
            /** @default 0 */
            floor_cpm_vnd: number;
            fill_rate?: number | null;
        } & {
            [key: string]: unknown;
        };
        RtbFloorPage: {
            items: components["schemas"]["RtbFloor"][];
            total: number;
            page: number;
            page_size: number;
        };
        ScheduleSlot: {
            id: string | number;
            campaign_id?: string | null;
            name: string;
            start_min: number;
            end_min: number;
            color?: number;
            target_type?: string | null;
            header?: string | null;
            footer?: string | null;
        } & {
            [key: string]: unknown;
        };
        ScheduleSlotPage: {
            items: components["schemas"]["ScheduleSlot"][];
            total: number;
            page: number;
            page_size: number;
        };
        Screen: {
            id: string | number;
            name: string;
            type: string;
            venue_kind?: string | null;
            size?: string | null;
            resolution?: string | null;
            /** @default 1 */
            screens: number;
            region?: string | null;
            status: string;
        } & {
            [key: string]: unknown;
        };
        ScreenPage: {
            items: components["schemas"]["Screen"][];
            total: number;
            page: number;
            page_size: number;
        };
        SepaySettings: {
            /** @default false */
            enabled: boolean;
            bank?: string | null;
            account_number?: string | null;
            account_holder?: string | null;
            /** @default AMS */
            prefix: string;
            webhook_url: string;
            auth_mode?: string | null;
            auto_activate?: boolean;
            /** @default 0 */
            min_activate_vnd: number;
            env?: string | null;
            dev_mode?: boolean;
            has_secret?: boolean;
            recent?: ({
                id: string | number;
                at: string;
                content?: string | null;
                /** @default 0 */
                amount_vnd: number;
                result?: string | null;
                customer?: string | null;
            } & {
                [key: string]: unknown;
            })[];
        } & {
            [key: string]: unknown;
        };
        Topup: {
            id: string | number;
            code?: string | null;
            customer_id?: string | null;
            customer_name?: string | null;
            method?: string | null;
            /** @default 0 */
            amount_vnd: number;
            status: string;
            created_at: string;
            payment_code?: string | null;
        } & {
            [key: string]: unknown;
        };
        TopupCreated: {
            id: string | number;
            payment_code: string;
            content?: string;
            qr_url?: string;
            bank?: string;
            account_number?: string;
            account_holder?: string;
            /** @default 0 */
            amount_vnd: number;
            /** @default 0 */
            min_amount_vnd: number;
        } & {
            [key: string]: unknown;
        };
        TopupPage: {
            items: components["schemas"]["Topup"][];
            total: number;
            page: number;
            page_size: number;
        };
        UploadUrl: {
            id: string | number;
            url: string;
            method?: string;
            headers?: {
                [key: string]: string;
            };
            /** @enum {string} */
            via?: "direct" | "proxy" | "multipart";
            multipart?: {
                part_size: number;
                total_parts: number;
            } & {
                [key: string]: unknown;
            };
        } & {
            [key: string]: unknown;
        };
        Wallet: {
            customer_id: string;
            customer_name?: string | null;
            /** @default 0 */
            balance_vnd: number;
            /** @default 0 */
            reserved_vnd: number;
            /** @default 0 */
            spent_vnd: number;
            /** @default 0 */
            available_vnd: number;
        } & {
            [key: string]: unknown;
        };
        WalletPage: {
            items: components["schemas"]["Wallet"][];
            total: number;
            page: number;
            page_size: number;
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
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    adminGetActivationLog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivationLog"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostActivationLogByIdUndo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetApprovals: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetAuditLog: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEntryPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBillingCustomersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBillingEvents: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBillingReceivables: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostBillingRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBillingSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutBillingSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutBillingSettingsRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBillingSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcast: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostBroadcast: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostBroadcastRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastInsightsEventsHeartbeat: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastInsightsEventsLogs: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastInsightsLogs: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastInsightsQueue: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastInsightsRecommend: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostBroadcastInsightsRecommend: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostBroadcastInsightsRecommendRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastInsightsSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastDevicesPick: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastNotice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostBroadcastNotice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostBroadcastNoticeRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastNoticeByBatchStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batch: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutBroadcastById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutBroadcastByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteBroadcastById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastByIdDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostBroadcastByIdPublish: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostBroadcastByIdUnpublish: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetBroadcastByIdUsbPackage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetCampaigns: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaigns: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostCampaignsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetCampaignsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutCampaignsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutCampaignsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteCampaignsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaignsByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApproveResult"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaignsByIdEnd: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaignsByIdPause: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetCampaignsByIdQuote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Quote"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaignsByIdReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostCampaignsByIdRejectRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaignsByIdResume: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutCampaignsByIdRewardConfig: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutCampaignsByIdRewardConfigRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCampaignsByIdSubmit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostCampaignsByIdSubmitRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceCampaignsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutComplianceCampaignsByIdCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutComplianceCampaignsByIdCategoryRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceCampaignsByIdSecondApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceCampaignsByIdSecondApprovalRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceConsents: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceConsents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceConsentsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceDsr: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceDsr: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceDsrRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceDsrByIdExecute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceDsrByIdExecuteRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceDsrByIdReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceDsrByIdRejectRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceKyc: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceKycByCustomerId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceKycByCustomerIdDecision: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceKycByCustomerIdDecisionRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceKycByCustomerIdDocumentsUploadUrl: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceKycByCustomerIdDocumentsUploadUrlRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceKycByCustomerIdDocumentsByIdConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceKycByCustomerIdDocumentsByIdReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceKycByCustomerIdDocumentsByIdReviewRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutComplianceKycByCustomerIdProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutComplianceKycByCustomerIdProfileRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceKycByCustomerIdSubmit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceProcessingRecords: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceProcessingRecords: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostComplianceProcessingRecordsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutComplianceProcessingRecordsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutComplianceProcessingRecordsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetComplianceRetention: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutComplianceRetention: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutComplianceRetentionRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostComplianceRetentionRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsByContractByContractId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                contractId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractDocsByContractByContractId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                contractId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractDocsByContractByContractIdRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsLogo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutContractDocsLogo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutContractDocsLogoRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteContractDocsLogo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsLogoImage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractDocsTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractDocsTemplatesRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractDocsTemplatesImportPreview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsTemplatesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutContractDocsTemplatesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutContractDocsTemplatesByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractDocsTemplatesByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractDocsTemplatesByIdApproveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsTemplatesByIdExport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsVariables: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutContractDocsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutContractDocsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteContractDocsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractDocsByIdFinalize: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractDocsByIdFinalizeRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsByIdPdf: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractDocsByIdPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContracts: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContractPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContracts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contract"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contract"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutContractsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutContractsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contract"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetContractsByIdLines: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractsByIdLines: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractsByIdLinesRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutContractsByIdLinesByLineId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                lineId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutContractsByIdLinesByLineIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteContractsByIdLinesByLineId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                lineId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostContractsByIdRender: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostContractsByIdRenderRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContractRender"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetCustomers: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostCustomers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostCustomersRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Customer"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetCustomersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Customer"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutCustomersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Customer"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteCustomersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPatchCustomersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Customer"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDashboardOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Overview"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDeviceGroups: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDeviceGroups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDeviceGroupsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutDeviceGroupsAssign: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutDeviceGroupsAssignRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDeviceGroupsDevices: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPatchDeviceGroupsDevicesByDeviceId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deviceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPatchDeviceGroupsDevicesByDeviceIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteDeviceGroupsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPatchDeviceGroupsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPatchDeviceGroupsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDeviceGroupsByIdVolume: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDeviceGroupsByIdVolumeRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDevices: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DevicePage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesBulk: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDevicesBulkRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesBulkDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDevicesBulkDeleteRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesPair: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDevicesPairRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDevicesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteDevicesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDevicesByIdApproveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDevicesByIdCommands: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesByIdCommands: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostDevicesByIdCommandsRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDevicesByIdCommandsByCid: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                cid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesByIdCommandsByCidCancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                cid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetDevicesByIdLogs: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutDevicesByIdOwner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutDevicesByIdOwnerRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostDevicesByIdRevokeApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetEinvoices: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostEinvoicesAdjust: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostEinvoicesAdjustRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostEinvoicesInvoiceByInvoiceIdIssue: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                invoiceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostEinvoicesInvoiceByInvoiceIdIssueRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetEinvoicesSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutEinvoicesSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutEinvoicesSettingsRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetEinvoicesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostEinvoicesByIdCancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostEinvoicesByIdCancelRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostEinvoicesByIdConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostEinvoicesByIdConfirmRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostEinvoicesByIdRefresh: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostEinvoicesByIdRetry: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetHistory: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetHistoryProofOfPlay: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetHistoryByEventId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetInvoices: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostInvoices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostInvoicesRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetInvoicesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutInvoicesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutInvoicesByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostInvoicesByIdIssue: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostInvoicesByIdIssueRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostInvoicesByIdPay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostInvoicesByIdPayRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostInvoicesByIdVoid: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostInvoicesByIdVoidRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLayoutTemplates: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostLayoutTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostLayoutTemplatesRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLayoutTemplatesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutLayoutTemplatesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutLayoutTemplatesByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteLayoutTemplatesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLegalAcceptances: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLegalCoverage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLegalDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostLegalDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostLegalDocumentsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLegalDocumentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutLegalDocumentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutLegalDocumentsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostLegalDocumentsByIdPublish: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostLegalDocumentsByIdPublishRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostLegalDocumentsByIdRetire: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLocations: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostLocations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostLocationsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutLocationsAssign: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutLocationsAssignRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetLocationsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteLocationsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPatchLocationsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPatchLocationsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetMedia: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaBulkDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaBulkDeleteRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaBulkDeleteResult"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaImport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaImportRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaLink: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaLinkRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Media"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetMediaScanReviewQueue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaUploadUrl: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaUploadUrlRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadUrl"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetMediaById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Media"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteMediaById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPatchMediaById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPatchMediaByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Media"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaByIdApproveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaByIdConfirmRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutMediaByIdContent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdImportRetry: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdMultipart: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdMultipartAbort: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdMultipartComplete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaByIdMultipartCompleteRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutMediaByIdOverlay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutMediaByIdOverlayRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutMediaByIdPartsByN: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                n: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdRecheck: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetMediaByIdReferences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaByIdRejectRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostMediaByIdScanReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostMediaByIdScanReviewRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetMediaByIdThumbnail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutMediaByIdThumbnail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostOpsIncidentsByIdAck: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostOpsIncidentsByIdAckRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostOpsReencryptFields: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostOpsReencryptFieldsRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostOpsRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutOpsSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutOpsSettingsRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetOpsSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostOpsTestNotification: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPartners: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PartnerPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostPartners: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostPartnersRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Partner"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPartnersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Partner"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutPartnersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutPartnersByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Partner"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPaymentsManualQueue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManualQueue"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostPaymentsManualQueueByIdResolve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostPaymentsManualQueueByIdResolveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPayouts: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPayoutsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPayoutsByIdDestination: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostPayoutsByIdPay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostPayoutsByIdPayRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostPayoutsByIdReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostPayoutsByIdRejectRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPermissionsByAdminId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                adminId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutPermissionsByAdminId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                adminId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutPermissionsByAdminIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetPricingQuote: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Quote"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetRateCards: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateCardPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostRateCards: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostRateCardsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateCard"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetRateCardsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateCard"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutRateCardsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutRateCardsByIdRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateCard"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteRateCardsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostReconcileRepair: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostReconcileRepairRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetReconcileRevenue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostReconcileRevenueRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostReconcileRevenueRunRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostReconcileRevenueByIdResolve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostReconcileRevenueByIdResolveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostReconcileSepay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetRefundRequests: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundRequests"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostRefundRequestsByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostRefundRequestsByIdApproveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostRefundRequestsByIdPaid: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostRefundRequestsByIdPaidRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostRefundRequestsByIdReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostRefundRequestsByIdRejectRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetRevenue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Revenue"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetRevenueHourly: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetRtbFloors: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RtbFloorPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostRtbFloors: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostRtbFloorsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RtbFloor"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutRtbFloorsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutRtbFloorsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RtbFloor"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetSchedule: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleSlotPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostSchedule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostScheduleRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleSlot"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetScheduleById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleSlot"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutScheduleById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutScheduleByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleSlot"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminDeleteScheduleById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutScheduleByIdText: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutScheduleByIdTextRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetScreens: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScreenPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostScreens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostScreensRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Screen"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetScreensSignageConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutScreensSignageConfigByKind: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kind: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetScreensById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Screen"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutScreensById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutScreensByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Screen"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetSettingsSepay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SepaySettings"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutSettingsSepay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutSettingsSepayRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SepaySettings"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetSettingsSepayChanges: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostSettingsSepayChangesByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostSettingsSepayChangesByIdApproveRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostSettingsSepayChangesByIdReject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostSettingsSepayTest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetTopups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopupPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostTopups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Topup"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostTopupsByIdConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetTvExperience: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetTvExperienceCreatives: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetTvExperienceCreativesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutTvExperienceCreativesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutTvExperienceCreativesByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutTvExperienceSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutTvExperienceSettingsRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetUsers: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostUsersRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetUsersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPutUsersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutUsersByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostUsersByIdResendInvite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostUsersByIdResetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostUsersByIdResetPasswordRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetWalletAdjustments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostWalletAdjustmentsByIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetWallets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WalletPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminGetWalletsByCustomerId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Wallet"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    adminPostWalletsByCustomerIdAdjustments: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPostWalletsByCustomerIdAdjustmentsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostChangePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostInviteAccept: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthPostInviteAcceptRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authGetInviteInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthPostLoginRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResult"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authGetMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostMfaEnroll: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthPostMfaEnrollRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnroll"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostMfaVerify: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthPostMfaVerifyRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    authPostPasswordChange: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    GetHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    GetLegalDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    GetLegalDocumentsByKind: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kind: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    PostOpsBackupReport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PostOpsBackupReportRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetCampaigns: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostCampaigns: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostCampaignsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetCampaignsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPutCampaignsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPutCampaignsByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostCampaignsByIdPause: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetCampaignsByIdQuote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Quote"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostCampaignsByIdResume: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostCampaignsByIdSubmit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostCampaignsByIdSubmitRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetEinvoices: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetHistory: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetHistoryProofOfPlay: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetHistoryByEventId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetInvoices: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetInvoicesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetKyc: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostKycDocumentsUploadUrl: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostKycDocumentsUploadUrlRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalDeleteKycDocumentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã xóa */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostKycDocumentsByIdConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPutKycProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPutKycProfileRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostKycSubmit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostLegalAccept: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostLegalAcceptRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetLegalDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetLegalDocumentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetLegalPending: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetMedia: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                /** @description Tìm kiếm văn bản (các cột tìm kiếm của danh sách) */
                q?: string;
                /** @description `<trường>:<asc|desc>` */
                sort?: string;
                /** @description `khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaImport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostMediaImportRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaLink: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostMediaLinkRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Media"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaUploadUrl: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostMediaUploadUrlRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadUrl"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetMediaById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Media"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPatchMediaById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPatchMediaByIdRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Media"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaByIdConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostMediaByIdConfirmRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPutMediaByIdContent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaByIdImportRetry: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaByIdMultipart: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaByIdMultipartAbort: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaByIdMultipartComplete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostMediaByIdMultipartCompleteRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPutMediaByIdOverlay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPutMediaByIdOverlayRequest"];
            };
        };
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPutMediaByIdPartsByN: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                n: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostMediaByIdRecheck: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetMediaByIdReferences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetMediaByIdThumbnail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPutMediaByIdThumbnail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetPricingQuote: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Quote"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetTopups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopupPage"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostTopups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopupCreated"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetWallet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PortalWallet"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalGetWalletRefundRequests: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundRequests"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    portalPostWalletRefundRequests: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PortalPostWalletRefundRequestsRequest"];
            };
        };
        responses: {
            /** @description Đã tạo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    GetStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
    webhookPostPaymentsSepay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Thành công */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenericObject"];
                };
            };
            "4XX": components["responses"]["Error"];
            "5XX": components["responses"]["Error"];
        };
    };
}
