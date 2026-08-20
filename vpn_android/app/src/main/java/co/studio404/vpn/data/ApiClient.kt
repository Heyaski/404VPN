package co.studio404.vpn.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiClient(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val tokenProvider: () -> String?,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun redeem(code: String, deviceName: String): RedeemResponse {
        val body = JSONObject()
            .put("code", code)
            .put("deviceName", deviceName)
            .put("platform", "android")
        val json = request("/api/redeem", method = "POST", body = body, authorized = false)
        return RedeemResponse(
            token = json.getString("token"),
            balance = json.getString("balance"),
            daysLeft = json.optIntOrNull("daysLeft"),
        )
    }

    fun me(): MeResponse {
        val json = request("/api/device/me", method = "GET")
        return MeResponse(
            balance = json.getString("balance"),
            status = json.getString("status"),
            devices = json.getInt("devices"),
            deviceName = json.optString("deviceName").ifBlank { null },
            daysLeft = json.optIntOrNull("daysLeft"),
        )
    }

    fun tunnel(): TunnelConfig {
        val json = request("/api/device/tunnel", method = "POST")
        val peerJson = json.getJSONObject("peer")
        return TunnelConfig(
            privateKey = json.getString("privateKey"),
            address = json.getString("address"),
            dns = json.optStringList("dns"),
            dnsFiltered = json.optStringList("dnsFiltered"),
            bypassRoutes = json.optStringList("bypassRoutes"),
            peer = TunnelPeer(
                publicKey = peerJson.getString("publicKey"),
                presharedKey = peerJson.optString("presharedKey").ifBlank { null },
                endpoint = peerJson.getString("endpoint"),
                allowedIps = peerJson.optStringList("allowedIps").ifEmpty {
                    listOf("0.0.0.0/0", "::/0")
                },
                persistentKeepalive = peerJson.optIntOrNull("persistentKeepalive"),
            ),
        )
    }

    fun revokeDevice() {
        request("/api/device", method = "DELETE", expectBody = false)
    }

    private fun request(
        path: String,
        method: String,
        body: JSONObject? = null,
        authorized: Boolean = true,
        expectBody: Boolean = true,
    ): JSONObject {
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Content-Type", "application/json")
        if (authorized) {
            val token = tokenProvider()
                ?: throw ApiException.Unauthorized
            builder.header("Authorization", "Bearer $token")
        }
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> {
                if (body != null) {
                    builder.delete(body.toString().toRequestBody(jsonMedia))
                } else {
                    builder.delete()
                }
            }
            else -> builder.method(
                method,
                (body ?: JSONObject()).toString().toRequestBody(jsonMedia),
            )
        }

        val response = try {
            client.newCall(builder.build()).execute()
        } catch (_: Exception) {
            throw ApiException.Network("Нет связи с сервером")
        }

        val raw = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val code = try {
                JSONObject(raw).optString("error")
            } catch (_: Exception) {
                ""
            }
            throw ApiException.from(code, response.code)
        }
        if (!expectBody || raw.isBlank()) return JSONObject()
        return try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw ApiException.Network("Неожиданный ответ сервера")
        }
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://404studiotech-miniapp.ru"
    }
}

private fun JSONObject.optStringList(key: String): List<String> {
    if (!has(key) || isNull(key)) return emptyList()
    val arr = optJSONArray(key) ?: return emptyList()
    return buildList {
        for (i in 0 until arr.length()) {
            val v = arr.optString(i)
            if (v.isNotBlank()) add(v)
        }
    }
}

private fun JSONObject.optIntOrNull(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return optInt(key)
}

private fun JSONArray.optStringList(): List<String> = buildList {
    for (i in 0 until length()) {
        val v = optString(i)
        if (v.isNotBlank()) add(v)
    }
}
