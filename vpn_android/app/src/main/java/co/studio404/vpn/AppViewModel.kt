package co.studio404.vpn

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import co.studio404.vpn.data.ApiException
import co.studio404.vpn.data.CodeFormatter
import co.studio404.vpn.data.MeResponse
import co.studio404.vpn.prefs.AutoConnectMode
import co.studio404.vpn.stats.SessionRecord
import co.studio404.vpn.stats.TunnelStats
import co.studio404.vpn.vpn.AutoConnectBus
import co.studio404.vpn.vpn.VpnStatus
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class UiState(
    val hasToken: Boolean = false,
    val me: MeResponse? = null,
    val busy: Boolean = false,
    val errorMessage: String? = null,
    val dnsFilter: Boolean = false,
    val dnsFilterAvailable: Boolean = false,
    val autoConnectMode: AutoConnectMode = AutoConnectMode.OFF,
    val trustedNetworks: List<String> = emptyList(),
    val pendingVpnPermission: Boolean = false,
    val liveStats: TunnelStats = TunnelStats.Empty,
    val speedHistory: List<Double> = emptyList(),
    val sessions: List<SessionRecord> = emptyList(),
)

class AppViewModel(
    private val app: VpnApp,
) : ViewModel() {
    private val tokens = app.tokenStore
    private val prefs = app.preferences
    private val api = app.api
    private val vpn = app.tunnelManager
    private val statsStore = app.statsStore

    private val _ui = MutableStateFlow(
        UiState(
            hasToken = tokens.token != null,
            dnsFilter = prefs.dnsFilter,
            dnsFilterAvailable = prefs.dnsFilterAvailable,
            autoConnectMode = prefs.autoConnectMode,
            trustedNetworks = prefs.trustedNetworks,
            sessions = statsStore.readSessions(),
        ),
    )
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val vpnStatus: StateFlow<VpnStatus> = vpn.status.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        VpnStatus.DISCONNECTED,
    )

    private var statsJob: Job? = null
    private var lastStats: TunnelStats = TunnelStats.Empty

    init {
        vpn.refreshBackendState()
        AutoConnectBus.setHandler {
            viewModelScope.launch { tryAutoConnect() }
        }
        vpn.startAutoConnectWatcher()
        viewModelScope.launch {
            vpn.status.collect { status ->
                if (status == VpnStatus.CONNECTED) startStatsPolling()
                else stopStatsPolling()
            }
        }
        if (tokens.token != null) {
            viewModelScope.launch { refresh() }
        }
    }

    override fun onCleared() {
        AutoConnectBus.setHandler(null)
        vpn.stopAutoConnectWatcher()
        stopStatsPolling()
        super.onCleared()
    }

    fun refreshSessions() {
        _ui.value = _ui.value.copy(sessions = statsStore.readSessions())
    }

    fun redeem(codeRaw: String) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, errorMessage = null)
            try {
                val code = CodeFormatter.format(codeRaw)
                val deviceName = deviceName()
                val response = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    api.redeem(code, deviceName)
                }
                tokens.token = response.token
                _ui.value = _ui.value.copy(hasToken = true, busy = false)
                refresh()
            } catch (e: Exception) {
                _ui.value = _ui.value.copy(
                    busy = false,
                    errorMessage = e.message ?: "Ошибка активации",
                )
            }
        }
    }

    fun refresh() {
        if (tokens.token == null) return
        viewModelScope.launch {
            try {
                val me = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    api.me()
                }
                prefs.lastBalance = me.balance
                vpn.setAccountSuspended(me.isSuspended)
                _ui.value = _ui.value.copy(
                    me = me,
                    errorMessage = null,
                    dnsFilter = prefs.dnsFilter,
                    dnsFilterAvailable = prefs.dnsFilterAvailable,
                    autoConnectMode = prefs.autoConnectMode,
                    trustedNetworks = prefs.trustedNetworks,
                )
                if (me.isSuspended && vpnStatus.value == VpnStatus.CONNECTED) {
                    vpn.disconnect()
                }
            } catch (e: Exception) {
                handleError(e)
            }
        }
    }

    fun onConnectClick() {
        viewModelScope.launch {
            if (vpnStatus.value == VpnStatus.CONNECTED || vpnStatus.value == VpnStatus.CONNECTING) {
                disconnect()
            } else {
                connect()
            }
        }
    }

    fun onVpnPermissionResult(granted: Boolean) {
        _ui.value = _ui.value.copy(pendingVpnPermission = false)
        if (granted) {
            viewModelScope.launch { connect(skipPermissionCheck = true) }
        } else {
            _ui.value = _ui.value.copy(errorMessage = "Без разрешения VPN подключение невозможно")
        }
    }

    private suspend fun connect(skipPermissionCheck: Boolean = false) {
        if (_ui.value.me?.isSuspended == true) {
            _ui.value = _ui.value.copy(errorMessage = ApiException.Suspended.message)
            return
        }
        if (!skipPermissionCheck) {
            val prepare = vpn.prepareVpnIntent()
            if (prepare != null) {
                _ui.value = _ui.value.copy(pendingVpnPermission = true)
                pendingPermissionIntent = prepare
                return
            }
        }
        _ui.value = _ui.value.copy(busy = true, errorMessage = null)
        try {
            vpn.connect(filtered = prefs.dnsFilter)
            _ui.value = _ui.value.copy(
                dnsFilterAvailable = prefs.dnsFilterAvailable,
                dnsFilter = prefs.dnsFilter,
            )
            refreshSessions()
        } catch (e: Exception) {
            handleError(e)
        } finally {
            _ui.value = _ui.value.copy(busy = false)
        }
    }

    private suspend fun disconnect() {
        _ui.value = _ui.value.copy(busy = true)
        try {
            vpn.disconnect()
            refreshSessions()
        } finally {
            _ui.value = _ui.value.copy(busy = false)
        }
    }

    private suspend fun tryAutoConnect() {
        if (tokens.token == null) return
        if (_ui.value.me?.isSuspended == true) return
        if (vpnStatus.value == VpnStatus.CONNECTED || vpnStatus.value == VpnStatus.CONNECTING) return
        if (prefs.autoConnectMode == AutoConnectMode.OFF) return
        runCatching { connect() }
    }

    fun setAutoConnect(mode: AutoConnectMode) {
        prefs.autoConnectMode = mode
        _ui.value = _ui.value.copy(autoConnectMode = mode)
        vpn.startAutoConnectWatcher()
    }

    fun setTrustedNetworks(networks: List<String>) {
        prefs.trustedNetworks = networks
        _ui.value = _ui.value.copy(trustedNetworks = networks)
        vpn.startAutoConnectWatcher()
    }

    fun setDnsFilter(enabled: Boolean) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, dnsFilter = enabled)
            try {
                vpn.applyDnsFilter(enabled)
                _ui.value = _ui.value.copy(
                    dnsFilter = prefs.dnsFilter,
                    dnsFilterAvailable = prefs.dnsFilterAvailable,
                )
                refreshSessions()
            } catch (e: Exception) {
                handleError(e)
            } finally {
                _ui.value = _ui.value.copy(busy = false)
            }
        }
    }

    fun unlink() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true)
            try {
                runCatching {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        api.revokeDevice()
                    }
                }
                runCatching { vpn.disconnect() }
                signOut()
            } finally {
                _ui.value = _ui.value.copy(busy = false)
            }
        }
    }

    private fun startStatsPolling() {
        if (statsJob?.isActive == true) return
        lastStats = vpn.currentStats()
        statsJob = viewModelScope.launch {
            while (isActive && vpnStatus.value == VpnStatus.CONNECTED) {
                val fresh = vpn.currentStats()
                vpn.persistLiveStats()
                val elapsedSec = ((fresh.capturedAtMs - lastStats.capturedAtMs).coerceAtLeast(1)) / 1000.0
                val delta = (fresh.rxBytes + fresh.txBytes) - (lastStats.rxBytes + lastStats.txBytes)
                val speed = (delta / elapsedSec).coerceAtLeast(0.0)
                val history = (_ui.value.speedHistory + speed).takeLast(24)
                _ui.value = _ui.value.copy(liveStats = fresh, speedHistory = history)
                lastStats = fresh
                delay(1000)
            }
        }
    }

    private fun stopStatsPolling() {
        statsJob?.cancel()
        statsJob = null
        _ui.value = _ui.value.copy(
            liveStats = TunnelStats.Empty,
            speedHistory = emptyList(),
        )
        refreshSessions()
    }

    private fun signOut() {
        tokens.clear()
        _ui.value = UiState(
            hasToken = false,
            dnsFilter = prefs.dnsFilter,
            dnsFilterAvailable = prefs.dnsFilterAvailable,
            autoConnectMode = prefs.autoConnectMode,
            trustedNetworks = prefs.trustedNetworks,
            sessions = statsStore.readSessions(),
        )
    }

    private fun handleError(e: Exception) {
        if (e is ApiException.Unauthorized) {
            signOut()
            _ui.value = _ui.value.copy(errorMessage = e.message)
            return
        }
        _ui.value = _ui.value.copy(errorMessage = e.message ?: "Ошибка")
    }

    private fun deviceName(): String {
        val model = Build.MODEL?.trim().orEmpty().ifBlank { "Android" }
        return "Android · $model".take(64)
    }

    var pendingPermissionIntent: android.content.Intent? = null
        private set

    companion object {
        fun factory(app: VpnApp): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return AppViewModel(app) as T
                }
            }
    }
}
