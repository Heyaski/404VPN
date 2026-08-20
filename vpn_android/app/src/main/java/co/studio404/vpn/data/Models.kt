package co.studio404.vpn.data

data class RedeemResponse(
    val token: String,
    val balance: String,
    val daysLeft: Int? = null,
)

data class MeResponse(
    val balance: String,
    val status: String,
    val devices: Int,
    val deviceName: String? = null,
    val daysLeft: Int? = null,
) {
    val isSuspended: Boolean get() = status != "active"
}

data class TunnelPeer(
    val publicKey: String,
    val presharedKey: String? = null,
    val endpoint: String,
    val allowedIps: List<String>,
    val persistentKeepalive: Int? = null,
)

data class TunnelConfig(
    val privateKey: String,
    val address: String,
    val dns: List<String>,
    val dnsFiltered: List<String> = emptyList(),
    val bypassRoutes: List<String> = emptyList(),
    val peer: TunnelPeer,
) {
    val isFilterAvailable: Boolean get() = dnsFiltered.isNotEmpty()

    fun wgQuick(filtered: Boolean, allowedIpsOverride: List<String>? = null): String {
        val resolvers = if (filtered && isFilterAvailable) dnsFiltered else dns
        val allowed = allowedIpsOverride ?: peer.allowedIps
        val lines = mutableListOf(
            "[Interface]",
            "PrivateKey = $privateKey",
            "Address = $address",
        )
        if (resolvers.isNotEmpty()) {
            lines += "DNS = ${resolvers.joinToString(", ")}"
        }
        lines += ""
        lines += "[Peer]"
        lines += "PublicKey = ${peer.publicKey}"
        val psk = peer.presharedKey
        if (!psk.isNullOrEmpty()) lines += "PresharedKey = $psk"
        lines += "AllowedIPs = ${allowed.joinToString(", ")}"
        lines += "Endpoint = ${peer.endpoint}"
        peer.persistentKeepalive?.let { lines += "PersistentKeepalive = $it" }
        return lines.joinToString("\n")
    }
}

sealed class ApiException(message: String) : Exception(message) {
    data object InvalidCode : ApiException("Такого кода не существует. Проверь символы.")
    data object AlreadyUsed : ApiException("Этот код уже активирован.")
    data object Expired : ApiException("Срок действия кода истёк.")
    data object Revoked : ApiException("Код отозван.")
    data object TooManyAttempts : ApiException("Слишком много попыток. Подожди минуту.")
    data object Suspended : ApiException("Баланс закончился — пополни, чтобы подключиться.")
    data object Blocked : ApiException("Доступ заблокирован.")
    data object Unauthorized : ApiException("Устройство больше не привязано. Введи код заново.")
    data object TunnelUnavailable : ApiException("Сервер сейчас не выдаёт подключения. Попробуй позже.")
    class Network(message: String) : ApiException(message)

    companion object {
        fun from(code: String, status: Int): ApiException = when (code) {
            "invalid_code" -> InvalidCode
            "already_used" -> AlreadyUsed
            "expired" -> Expired
            "revoked" -> Revoked
            "too_many_attempts" -> TooManyAttempts
            "suspended" -> Suspended
            "blocked" -> Blocked
            "unauthorized" -> Unauthorized
            "wg_unavailable" -> TunnelUnavailable
            else -> Network("Ошибка сервера ($status)")
        }
    }
}

object CodeFormatter {
    const val MAX_LENGTH = 16

    fun format(raw: String): String {
        val cleaned = raw.uppercase().filter { it.isLetterOrDigit() }.take(MAX_LENGTH)
        return cleaned.chunked(4).joinToString("-")
    }

    fun isComplete(formatted: String): Boolean =
        formatted.count { it.isLetterOrDigit() } == MAX_LENGTH

    /**
     * Форматирует код и сохраняет курсор по числу введённых символов
     * (дефисы не сбивают позицию).
     */
    fun formatWithCursor(raw: String, cursor: Int): Pair<String, Int> {
        val clamped = cursor.coerceIn(0, raw.length)
        val alphanumBefore = raw.take(clamped).count { it.isLetterOrDigit() }
            .coerceAtMost(MAX_LENGTH)
        val formatted = format(raw)
        if (alphanumBefore == 0) return formatted to 0

        var seen = 0
        for (i in formatted.indices) {
            if (formatted[i].isLetterOrDigit()) {
                seen++
                if (seen == alphanumBefore) {
                    return formatted to (i + 1)
                }
            }
        }
        return formatted to formatted.length
    }
}
