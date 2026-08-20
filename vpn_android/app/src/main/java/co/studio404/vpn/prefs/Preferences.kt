package co.studio404.vpn.prefs

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

enum class AutoConnectMode(val title: String) {
    OFF("Выключено"),
    ALWAYS("Всегда"),
    CELLULAR_ONLY("Только сотовая сеть"),
    WIFI_ONLY("Только Wi-Fi"),
}

class Preferences(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("vpn_prefs", Context.MODE_PRIVATE)

    var autoConnectMode: AutoConnectMode
        get() = AutoConnectMode.entries
            .firstOrNull { it.name == prefs.getString(KEY_AUTO, null) }
            ?: AutoConnectMode.OFF
        set(value) = prefs.edit().putString(KEY_AUTO, value.name).apply()

    var trustedNetworks: List<String>
        get() {
            val raw = prefs.getString(KEY_TRUSTED, null) ?: return emptyList()
            return runCatching {
                val arr = JSONArray(raw)
                buildList {
                    for (i in 0 until arr.length()) {
                        val v = arr.optString(i).trim()
                        if (v.isNotEmpty()) add(v)
                    }
                }
            }.getOrDefault(emptyList())
        }
        set(value) {
            val arr = JSONArray()
            value.forEach { arr.put(it) }
            prefs.edit().putString(KEY_TRUSTED, arr.toString()).apply()
        }

    var dnsFilter: Boolean
        get() = prefs.getBoolean(KEY_DNS_FILTER, false)
        set(value) = prefs.edit().putBoolean(KEY_DNS_FILTER, value).apply()

    var dnsFilterAvailable: Boolean
        get() = prefs.getBoolean(KEY_DNS_AVAILABLE, false)
        set(value) = prefs.edit().putBoolean(KEY_DNS_AVAILABLE, value).apply()

    var lastBalance: String?
        get() = prefs.getString(KEY_BALANCE, null)
        set(value) = prefs.edit().putString(KEY_BALANCE, value).apply()

    companion object {
        private const val KEY_AUTO = "autoConnectMode"
        private const val KEY_TRUSTED = "trustedNetworks"
        private const val KEY_DNS_FILTER = "dnsFilter"
        private const val KEY_DNS_AVAILABLE = "dnsFilterAvailable"
        private const val KEY_BALANCE = "lastBalance"
    }
}
