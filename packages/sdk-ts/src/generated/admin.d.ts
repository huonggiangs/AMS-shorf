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
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
        patch?: never;
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
        patch?: never;
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
        AdminPostCampaignsByIdRejectRequest: {
            reason: string;
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
        AdminPostDevicesBulkRequest: {
            /** @enum {string} */
            action: "verify" | "block" | "unblock";
            ids: string[];
        } & {
            [key: string]: unknown;
        };
        AdminPostDevicesPairRequest: {
            code: string;
            owner_name?: string;
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
        AdminPostMediaByIdConfirmRequest: {
            width?: number;
            height?: number;
            duration_sec?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaByIdRejectRequest: {
            reason: string;
        } & {
            [key: string]: unknown;
        };
        AdminPostMediaImportRequest: {
            /** @enum {string} */
            source: "youtube" | "drive" | "dropbox" | "url";
            url: string;
            name?: string;
            customer_id?: (unknown | string) | null;
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
        AdminPutCustomersByIdRequest: {
            legal_name?: string;
            short_name?: string | null;
            tax_code?: string | null;
            address?: string | null;
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
        AdminPutInvoicesByIdRequest: {
            amount_vnd?: number;
            vat_rate?: number;
        } & {
            [key: string]: unknown;
        };
        AdminPutMediaByIdOverlayRequest: {
            format?: string;
            overlay?: (unknown | unknown) | null;
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
            reject_reason?: string | null;
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
            reject_reason?: string | null;
            format?: string | null;
            sha256?: string | null;
            overlay?: unknown;
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
                reject_reason?: string | null;
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
        PortalPostMediaImportRequest: {
            /** @enum {string} */
            source: "youtube" | "drive" | "dropbox" | "url";
            url: string;
            name?: string;
            customer_id?: (unknown | string) | null;
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
    adminPostCampaignsByIdSubmit: {
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
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPutCustomersByIdRequest"];
            };
        };
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
    adminPostMediaByIdApprove: {
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
