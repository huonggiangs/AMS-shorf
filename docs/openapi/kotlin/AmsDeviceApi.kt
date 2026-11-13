// THAM KHAO (khong build trong repo). Khung client Kotlin cho app TV theo docs/openapi/ams-device-gateway.json.
// Phu thuoc goi y: Retrofit 2 + OkHttp 4 + kotlinx.serialization (hoac Moshi). Chu ky Ed25519: xem DeviceSigningInterceptor.
package vn.ams.device.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.Interceptor
import okhttp3.Response
import okio.Buffer
import retrofit2.http.*
import java.security.MessageDigest
import java.util.Base64

// ---------- Request ----------
@Serializable data class RegisterRequest(
    val pubkey: String,                    // 43 ky tu base64url (32 byte Ed25519)
    val kind: String = "tv",               // tv|elevator|led_p5|phone|virtual
    val model: String? = null, val os: String? = null,
    @SerialName("app_version") val appVersion: String? = null,
    val region: String? = null,
)
@Serializable data class HeartbeatRequest(
    val state: Int = 0,                    // 0 cho, 1 dang phat, 2 loi, 3 giam sat
    @SerialName("app_ver") val appVer: String? = null,
    @SerialName("soc_temp") val socTemp: Int? = null,
    val rssi: Int? = null,
    @SerialName("dl_mbps") val dlMbps: Double? = null,
    @SerialName("cache_used_mb") val cacheUsedMb: Int? = null,
    @SerialName("cache_slots") val cacheSlots: Int? = null,
    @SerialName("manifest_etag") val manifestEtag: String? = null,
    @SerialName("cmd_ack") val cmdAck: List<String>? = null, // cu; nen dung /v1/commands/ack
)
@Serializable data class CommandAck(val id: String, val status: String = "ok", val result: String? = null) // ok|failed
@Serializable data class CommandAckRequest(val acks: List<CommandAck>)

@Serializable data class ImpressionEvent(
    val type: String = "impression",
    @SerialName("event_id") val eventId: String,   // UUIDv7
    val ts: String,                                // ISO-8601 UTC
    @SerialName("campaign_id") val campaignId: String,
    @SerialName("creative_id") val creativeId: String,
    @SerialName("slot_id") val slotId: String? = null,
    @SerialName("vcr_pct") val vcrPct: Int,
    @SerialName("played_ms") val playedMs: Long,
)
@Serializable data class ProofOfPlayEvent(
    val type: String = "proof_of_play",
    @SerialName("event_id") val eventId: String, val ts: String,
    @SerialName("creative_id") val creativeId: String,
    @SerialName("duration_ms") val durationMs: Long,
)
// events la mang hon hop: dung JsonElement hoac serializer da hinh theo truong "type".
@Serializable data class EventsRequest(val events: List<kotlinx.serialization.json.JsonElement>) // 1..50

// ---------- Response ----------
@Serializable data class RegisterResponse(
    @SerialName("device_id") val deviceId: String,
    @SerialName("trust_level") val trustLevel: Int,
    @SerialName("attestation_nonce") val attestationNonce: String,
    @SerialName("server_time") val serverTime: String,
    val protocol: Int,
    @SerialName("heartbeat_interval") val heartbeatInterval: Int,
    val created: Boolean,
)
@Serializable data class PairResponse(
    val paired: Boolean, @SerialName("trust_level") val trustLevel: Int? = null,
    val code: String? = null, @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("expires_in") val expiresIn: Int? = null, @SerialName("ttl_s") val ttlS: Int? = null,
)
@Serializable data class DeviceCommand(val id: String, val type: String, val args: JsonObject? = null) // refresh_manifest|reboot|set_monitor; type la: bo qua nhung van ack
@Serializable data class HeartbeatResponse(
    val ok: Boolean,
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval") val nextInterval: Double,
    @SerialName("interval_base") val intervalBase: Double,
    @SerialName("manifest_etag") val manifestEtag: String,
    @SerialName("manifest_group") val manifestGroup: String,
    @SerialName("manifest_url") val manifestUrl: String,
    val commands: List<DeviceCommand> = emptyList(),
    @SerialName("min_app_version") val minAppVersion: String? = null,
)
@Serializable data class CommandAckResponse(val ok: Boolean, val acked: Int, val known: Int, val unknown: Int)
@Serializable data class RejectedEvent(@SerialName("event_id") val eventId: String?, val reason: String)
@Serializable data class EventsResponse(val accepted: Int, val valid: Int, val flagged: Int, val rejected: List<RejectedEvent>)

@Serializable data class ManifestCreative(
    val id: String, @SerialName("campaign_id") val campaignId: String, val url: String,
    val sha256: String,                                   // PHAI kiem tra truoc khi phat
    @SerialName("duration_s") val durationS: Double? = null,
    @SerialName("px_w") val pxW: Int? = null, @SerialName("px_h") val pxH: Int? = null,
    val format: String,                                   // fullscreen|menu_banner|l_banner|pause_ad|qr_corner|reward
    val overlay: JsonObject? = null,
    @SerialName("media_type") val mediaType: String,      // video|image
    @SerialName("size_bytes") val sizeBytes: Long? = null,
)
@Serializable data class ManifestSlot(
    @SerialName("slot_id") val slotId: String, @SerialName("campaign_id") val campaignId: String,
    @SerialName("creative_ids") val creativeIds: List<String>, val daypart: String,
    @SerialName("start_min") val startMin: Int, @SerialName("end_min") val endMin: Int,
    val priority: Int, @SerialName("reward_points") val rewardPoints: Int,
)
@Serializable data class Manifest(
    val version: Int, val group: String, val tz: String, val etag: String,
    @SerialName("generated_at") val generatedAt: String, @SerialName("ttl_s") val ttlS: Int,
    val creatives: List<ManifestCreative>, val schedule: List<ManifestSlot>,
)
@Serializable data class ManifestDelta(
    val version: Int, val group: String, val etag: String, @SerialName("base_etag") val baseEtag: String,
    @SerialName("generated_at") val generatedAt: String, @SerialName("ttl_s") val ttlS: Int,
    @SerialName("creatives_added") val creativesAdded: List<ManifestCreative>,
    @SerialName("creatives_removed") val creativesRemoved: List<String>, val schedule: List<ManifestSlot>,
)
@Serializable data class ErrorBody(val error: ErrorDetail)
@Serializable data class ErrorDetail(val code: String, val message: String, val details: kotlinx.serialization.json.JsonElement? = null)

// ---------- Retrofit ----------
interface AmsDeviceApi {
    @POST("v1/register") suspend fun register(@Body body: RegisterRequest): retrofit2.Response<RegisterResponse>   // 200|201
    @POST("v1/pair") suspend fun pair(): retrofit2.Response<PairResponse>   // body rong
    @POST("v1/heartbeat") suspend fun heartbeat(@Body body: HeartbeatRequest): retrofit2.Response<HeartbeatResponse>
    @POST("v1/commands/ack") suspend fun ackCommands(@Body body: CommandAckRequest): retrofit2.Response<CommandAckResponse>
    @GET("v1/manifest") suspend fun manifest(
        @Query("etag") etag: String? = null, @Query("delta") delta: String? = null, @Query("daypart") daypart: String? = null,
    ): retrofit2.Response<okhttp3.ResponseBody> // 200 (Manifest|ManifestDelta theo header X-Manifest-Kind) | 304
    @POST("v1/events") suspend fun events(@Body body: EventsRequest): retrofit2.Response<EventsResponse> // 202
}
// 429/503: doc header Retry-After va cho dung gia tri do (da co jitter).

// ---------- Chu ky Ed25519 (OkHttp interceptor) ----------
// Chuoi ky: METHOD \n PATH?QUERY \n TIMESTAMP \n NONCE \n SHA256_HEX(body). Sign: ham ky Ed25519 -> base64url (khong padding).
class DeviceSigningInterceptor(
    private val deviceId: () -> String?,
    private val sign: (ByteArray) -> ByteArray,
    private val nowSec: () -> Long = { System.currentTimeMillis() / 1000 },
) : Interceptor {
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val body = Buffer().also { req.body?.writeTo(it) }.readByteArray()
        val ts = nowSec().toString()
        val nonce = b64.encodeToString(ByteArray(16).also { java.security.SecureRandom().nextBytes(it) })
        val url = req.url
        val pathQuery = url.encodedPath + (url.encodedQuery?.let { "?$it" } ?: "")
        val sha = MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }
        val msg = "${req.method}\n$pathQuery\n$ts\n$nonce\n$sha".toByteArray(Charsets.UTF_8)
        val b = req.newBuilder().header("x-timestamp", ts).header("x-nonce", nonce).header("x-signature", b64.encodeToString(sign(msg)))
        deviceId()?.let { b.header("x-device-id", it) }   // /v1/register: chua co device_id
        return chain.proceed(b.build())
    }
}
