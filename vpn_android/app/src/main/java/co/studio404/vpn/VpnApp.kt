package co.studio404.vpn

import android.app.Application
import android.os.Build
import co.studio404.vpn.data.ApiClient
import co.studio404.vpn.data.TokenStore
import co.studio404.vpn.prefs.Preferences
import co.studio404.vpn.stats.StatsStore
import co.studio404.vpn.vpn.TunnelManager

class VpnApp : Application() {
    lateinit var tokenStore: TokenStore
        private set
    lateinit var preferences: Preferences
        private set
    lateinit var api: ApiClient
        private set
    lateinit var statsStore: StatsStore
        private set
    lateinit var tunnelManager: TunnelManager
        private set

    override fun onCreate() {
        super.onCreate()
        tokenStore = TokenStore(this)
        preferences = Preferences(this)
        statsStore = StatsStore(this)
        api = ApiClient(tokenProvider = { tokenStore.token })
        tunnelManager = TunnelManager(this, api, preferences, statsStore)
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(android.app.NotificationManager::class.java) ?: return
        val channel = android.app.NotificationChannel(
            "vpn",
            getString(R.string.vpn_channel_name),
            android.app.NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)
    }
}
