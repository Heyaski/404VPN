package co.studio404.vpn.vpn

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.net.wifi.WifiManager
import co.studio404.vpn.data.ApiClient
import co.studio404.vpn.data.ApiException
import co.studio404.vpn.data.TunnelConfig
import co.studio404.vpn.prefs.AutoConnectMode
import co.studio404.vpn.prefs.Preferences
import co.studio404.vpn.stats.StatsStore
import co.studio404.vpn.stats.TunnelStats
import com.wireguard.android.backend.BackendException
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream

enum class VpnStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    DISCONNECTING,
    ERROR,
}

class TunnelManager(
    private val appContext: Context,
    private val api: ApiClient,
    private val preferences: Preferences,
    private val statsStore: StatsStore,
) {
    private val backend = GoBackend(appContext)
    private val mutex = Mutex()
    private var lastConfig: TunnelConfig? = null
    private var accountSuspended: Boolean = false
    private var activeSessionId: String? = null

    private val _status = MutableStateFlow(VpnStatus.DISCONNECTED)
    val status: StateFlow<VpnStatus> = _status.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val tunnel = object : Tunnel {
        override fun getName(): String = TUNNEL_NAME
        override fun onStateChange(newState: Tunnel.State) {
            _status.value = when (newState) {
                Tunnel.State.UP -> VpnStatus.CONNECTED
                Tunnel.State.DOWN -> VpnStatus.DISCONNECTED
                Tunnel.State.TOGGLE -> _status.value
            }
        }
    }

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    fun prepareVpnIntent(): Intent? = VpnService.prepare(appContext)

    fun setAccountSuspended(suspended: Boolean) {
        accountSuspended = suspended
    }

    fun currentStats(): TunnelStats {
        val now = System.currentTimeMillis()
        return runCatching {
            val stats = backend.getStatistics(tunnel)
            TunnelStats(
                rxBytes = stats.totalRx(),
                txBytes = stats.totalTx(),
                capturedAtMs = now,
                isConnected = _status.value == VpnStatus.CONNECTED,
            )
        }.getOrElse {
            statsStore.readSnapshot().copy(capturedAtMs = now, isConnected = false)
        }
    }

    fun persistLiveStats() {
        if (_status.value != VpnStatus.CONNECTED) return
        val stats = currentStats()
        statsStore.writeSnapshot(stats)
        val sessionId = activeSessionId ?: return
        statsStore.updateSession(sessionId, stats.rxBytes, stats.txBytes)
    }

    suspend fun connect(filtered: Boolean = preferences.dnsFilter): Unit = mutex.withLock {
        if (accountSuspended) {
            _error.value = ApiException.Suspended.message
            return
        }
        if (VpnService.prepare(appContext) != null) {
            _error.value = "Нужно разрешить VPN в системе"
            _status.value = VpnStatus.ERROR
            return
        }
        _status.value = VpnStatus.CONNECTING
        _error.value = null
        try {
            val config = withContext(Dispatchers.IO) { api.tunnel() }
            lastConfig = config
            preferences.dnsFilterAvailable = config.isFilterAvailable
            val useFilter = filtered && config.isFilterAvailable
            val allowed = if (config.bypassRoutes.isNotEmpty()) {
                RouteCalculator.allowedIPsExcluding(config.bypassRoutes)
            } else {
                config.peer.allowedIps.ifEmpty { listOf("0.0.0.0/0", "::/0") }
            }
            val wgQuick = config.wgQuick(filtered = useFilter, allowedIpsOverride = allowed)
            val parsed = Config.parse(ByteArrayInputStream(wgQuick.toByteArray(Charsets.UTF_8)))
            withContext(Dispatchers.IO) {
                backend.setState(tunnel, Tunnel.State.UP, parsed)
            }
            activeSessionId = statsStore.openSession()
            val snap = currentStats()
            statsStore.writeSnapshot(snap)
            _status.value = VpnStatus.CONNECTED
        } catch (e: ApiException) {
            _status.value = VpnStatus.ERROR
            _error.value = e.message
            throw e
        } catch (e: BackendException) {
            _status.value = VpnStatus.ERROR
            _error.value = "Не удалось подключить туннель"
            throw e
        } catch (e: Exception) {
            _status.value = VpnStatus.ERROR
            _error.value = e.message ?: "Не удалось подключить туннель"
            throw e
        }
    }

    suspend fun disconnect(): Unit = mutex.withLock {
        _status.value = VpnStatus.DISCONNECTING
        try {
            val finalStats = currentStats()
            activeSessionId?.let { id ->
                statsStore.updateSession(
                    id = id,
                    rxBytes = finalStats.rxBytes,
                    txBytes = finalStats.txBytes,
                    endedAtMs = System.currentTimeMillis(),
                )
            }
            activeSessionId = null
            statsStore.writeSnapshot(finalStats.copy(isConnected = false))
            withContext(Dispatchers.IO) {
                backend.setState(tunnel, Tunnel.State.DOWN, null)
            }
        } finally {
            _status.value = VpnStatus.DISCONNECTED
        }
    }

    suspend fun applyDnsFilter(enabled: Boolean) {
        preferences.dnsFilter = enabled
        if (_status.value == VpnStatus.CONNECTED) {
            disconnect()
            connect(filtered = enabled)
        }
    }

    fun startAutoConnectWatcher() {
        stopAutoConnectWatcher()
        val cm = appContext.getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                maybeAutoConnect()
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities,
            ) {
                maybeAutoConnect()
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, callback)
        networkCallback = callback
        maybeAutoConnect()
    }

    fun stopAutoConnectWatcher() {
        networkCallback?.let {
            val cm = appContext.getSystemService(ConnectivityManager::class.java)
            runCatching { cm?.unregisterNetworkCallback(it) }
        }
        networkCallback = null
    }

    private fun maybeAutoConnect() {
        val mode = preferences.autoConnectMode
        if (mode == AutoConnectMode.OFF || accountSuspended) return
        if (_status.value == VpnStatus.CONNECTED || _status.value == VpnStatus.CONNECTING) return
        if (!networkMatches(mode)) return
        if (isOnTrustedWifi()) return
        AutoConnectBus.requestConnect()
    }

    private fun networkMatches(mode: AutoConnectMode): Boolean {
        val cm = appContext.getSystemService(ConnectivityManager::class.java) ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        val wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        val cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
        return when (mode) {
            AutoConnectMode.OFF -> false
            AutoConnectMode.ALWAYS -> wifi || cellular
            AutoConnectMode.WIFI_ONLY -> wifi
            AutoConnectMode.CELLULAR_ONLY -> cellular
        }
    }

    /** Как на iOS: имена вводятся вручную; если SSID прочитать нельзя — не блокируем. */
    private fun isOnTrustedWifi(): Boolean {
        val trusted = preferences.trustedNetworks
        if (trusted.isEmpty()) return false
        val ssid = currentWifiSsid() ?: return false
        return trusted.any { it.equals(ssid, ignoreCase = true) }
    }

    @Suppress("DEPRECATION")
    private fun currentWifiSsid(): String? {
        val cm = appContext.getSystemService(ConnectivityManager::class.java) ?: return null
        val network = cm.activeNetwork ?: return null
        val caps = cm.getNetworkCapabilities(network) ?: return null
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return null
        val wifi = appContext.applicationContext.getSystemService(WifiManager::class.java) ?: return null
        val raw = wifi.connectionInfo?.ssid?.trim().orEmpty()
        if (raw.isEmpty() || raw == "<unknown ssid>" || raw == "0x") return null
        return raw.trim('"')
    }

    fun refreshBackendState() {
        val up = runCatching { backend.getState(tunnel) == Tunnel.State.UP }.getOrDefault(false)
        if (up) _status.value = VpnStatus.CONNECTED
        else if (_status.value == VpnStatus.CONNECTED) _status.value = VpnStatus.DISCONNECTED
    }

    companion object {
        const val TUNNEL_NAME = "404VPN"
    }
}

object AutoConnectBus {
    @Volatile
    private var handler: (() -> Unit)? = null

    fun setHandler(block: (() -> Unit)?) {
        handler = block
    }

    fun requestConnect() {
        handler?.invoke()
    }
}
