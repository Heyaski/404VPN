package co.studio404.vpn.vpn

/** Порт RouteCalculator из vpn_ios / desktop: AllowedIPs = всё минус bypass. */
object RouteCalculator {
    data class IPPrefix(val bytes: ByteArray, val length: Int) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is IPPrefix) return false
            return length == other.length && bytes.contentEquals(other.bytes)
        }

        override fun hashCode(): Int = 31 * bytes.contentHashCode() + length
    }

    fun allowedIPsExcluding(raw: List<String>): List<String> {
        val excluded = raw.mapNotNull(::parse)
        return (
            whole(4, cover(4, excluded)) + whole(16, cover(16, excluded))
            ).map(::format)
    }

    private fun whole(family: Int, computed: List<IPPrefix>): List<IPPrefix> =
        if (computed.isEmpty()) {
            listOf(IPPrefix(ByteArray(family), 0))
        } else {
            computed
        }

    private fun cover(family: Int, excluded: List<IPPrefix>): List<IPPrefix> {
        val ofFamily = excluded.filter { it.bytes.size == family }
        val result = mutableListOf<IPPrefix>()
        walk(ByteArray(family), 0, ofFamily, result)
        return result
    }

    private fun walk(
        base: ByteArray,
        length: Int,
        excluded: List<IPPrefix>,
        result: MutableList<IPPrefix>,
    ) {
        val node = IPPrefix(base.copyOf(), length)
        if (excluded.any { covers(it, node) }) return
        val inside = excluded.filter { covers(node, it) }
        if (inside.isEmpty()) {
            result += node
            return
        }
        if (length >= base.size * 8) return
        for (bit in 0..1) {
            val child = base.copyOf()
            val byte = length shr 3
            val mask = (0x80 shr (length and 7)).toByte()
            if (bit == 1) {
                child[byte] = (child[byte].toInt() or mask.toInt()).toByte()
            } else {
                child[byte] = (child[byte].toInt() and mask.toInt().inv()).toByte()
            }
            walk(child, length + 1, inside, result)
        }
    }

    private fun covers(outer: IPPrefix, inner: IPPrefix): Boolean {
        if (outer.bytes.size != inner.bytes.size || outer.length > inner.length) return false
        for (bit in 0 until outer.length) {
            val byte = bit shr 3
            val mask = 0x80 shr (bit and 7)
            if ((outer.bytes[byte].toInt() and mask) != (inner.bytes[byte].toInt() and mask)) {
                return false
            }
        }
        return true
    }

    private fun parse(raw: String): IPPrefix? {
        val parts = raw.trim().split("/")
        if (parts.size != 2) return null
        val length = parts[1].toIntOrNull() ?: return null
        if (length < 0) return null
        val address = parts[0]
        val bytes = (if (address.contains(':')) parseIPv6(address) else parseIPv4(address))
            ?: return null
        if (length > bytes.size * 8) return null
        val masked = bytes.copyOf()
        if (length < bytes.size * 8) {
            for (bit in length until bytes.size * 8) {
                val b = bit shr 3
                masked[b] = (masked[b].toInt() and (0x80 shr (bit and 7)).inv()).toByte()
            }
        }
        return IPPrefix(masked, length)
    }

    private fun parseIPv4(address: String): ByteArray? {
        val parts = address.split(".")
        if (parts.size != 4) return null
        val out = ByteArray(4)
        for (i in 0..3) {
            val p = parts[i]
            if (p.isEmpty() || p.length > 3) return null
            val n = p.toIntOrNull() ?: return null
            if (n !in 0..255) return null
            out[i] = n.toByte()
        }
        return out
    }

    private fun parseIPv6(address: String): ByteArray? {
        val halves = address.split("::")
        if (halves.size > 2) return null

        fun groups(s: String): List<Int>? {
            if (s.isEmpty()) return emptyList()
            val out = mutableListOf<Int>()
            for (g in s.split(":")) {
                if (g.isEmpty() || g.length > 4) return null
                val n = g.toIntOrNull(16) ?: return null
                if (n !in 0..0xffff) return null
                out += n
            }
            return out
        }

        val head = groups(halves[0]) ?: return null
        val tail = if (halves.size == 2) groups(halves[1]) ?: return null else emptyList()
        val missing = 8 - head.size - tail.size
        if (if (halves.size == 1) missing != 0 else missing < 0) return null
        val all = head + List(missing) { 0 } + tail
        return ByteArray(16) { i ->
            val g = all[i / 2]
            if (i % 2 == 0) ((g shr 8) and 0xff).toByte() else (g and 0xff).toByte()
        }
    }

    private fun format(prefix: IPPrefix): String {
        if (prefix.bytes.size == 4) {
            return "${prefix.bytes.joinToString(".") { (it.toInt() and 0xff).toString() }}/${prefix.length}"
        }
        val groups = (0 until 16 step 2).map { i ->
            (((prefix.bytes[i].toInt() and 0xff) shl 8) or (prefix.bytes[i + 1].toInt() and 0xff))
                .toString(16)
        }
        var bestStart = -1
        var bestLength = 0
        var start = -1
        for (i in 0..groups.size) {
            if (i < groups.size && groups[i] == "0") {
                if (start == -1) start = i
            } else if (start != -1) {
                if (i - start > bestLength) {
                    bestLength = i - start
                    bestStart = start
                }
                start = -1
            }
        }
        val address = if (bestLength > 1) {
            val head = groups.subList(0, bestStart).joinToString(":")
            val tail = groups.subList(bestStart + bestLength, groups.size).joinToString(":")
            "$head::$tail"
        } else {
            groups.joinToString(":")
        }
        return "$address/${prefix.length}"
    }
}
