STATUS: done
UPDATED: 12:30 UTC

- Doc duoc (lan truoc, truoc khi mat ket noi D:): ma Java Brain-rot 1.0.39 tai D:\JOB\TV Block\publish\brainrot-app (TvBridgeService, TvOverlayController, TvReceiverActivity, TvAccessibilityService, TvMediaListenerService, AndroidManifest, build.gradle) + APK 1.0.39 (zipfile). Khong doi chieu lai duoc sau khi mat ket noi.
- Da lam: integrations/brainrot-tv (Java tham chieu 7 tep, ams-integration.patch, PATCH-NOTES.md, check/ stub + run.sh, schema zod, vi du VF9 tu ADS.png, 28 test vitest), docs/TV-APP-INTEGRATION.md (muc 8 rui ro/tuan thu), ops/agents/a4-tv-bridge.requests.md.
- Lan cuoi: doi chieu packages/shared/src/overlay.ts (parseOverlay) => nho limit/bo truong bat buoc phia client + schema; truong mo rong (kid_safe, contexts, duration_s, safe_area, qr.hint) chua co o may chu => yeu cau a1.
- Kiem: 39 kiem ngoai tuyen (javac + stub + BC 1.77) OK; 12 kiem gateway that da chay truoc khi noi long schema, chua chay lai; vitest 28 OK; tsc OK; git apply --check OK tren ban D: (truoc khi mat ket noi).
- Chua: build Android SDK, chay TV that, ap patch vao D:, app dien thoai gui ads-config.
