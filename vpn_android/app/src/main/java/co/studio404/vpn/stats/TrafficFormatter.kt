package co.studio404.vpn.stats

object TrafficFormatter {
    private val units = listOf("Б", "КБ", "МБ", "ГБ", "ТБ")

    fun bytes(value: Long): String {
        var amount = value.toDouble().coerceAtLeast(0.0)
        var unit = 0
        while (amount >= 1024 && unit < units.lastIndex) {
            amount /= 1024
            unit++
        }
        return if (unit == 0) {
            "${amount.toInt()} ${units[unit]}"
        } else {
            String.format("%.1f", amount).replace('.', ',') + " ${units[unit]}"
        }
    }

    fun money(raw: String): String = raw.replace('.', ',')

    fun duration(seconds: Long): String {
        val total = seconds.coerceAtLeast(0)
        val hours = total / 3600
        val minutes = (total % 3600) / 60
        return if (hours > 0) "$hours ч $minutes мин" else "$minutes мин"
    }
}
