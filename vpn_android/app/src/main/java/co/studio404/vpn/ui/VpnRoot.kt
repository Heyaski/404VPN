package co.studio404.vpn.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.compose.viewModel
import co.studio404.vpn.AppViewModel
import co.studio404.vpn.VpnApp
import co.studio404.vpn.ui.screens.DashboardScreen
import co.studio404.vpn.ui.screens.RedeemScreen
import co.studio404.vpn.ui.screens.SettingsScreen
import co.studio404.vpn.ui.screens.StatsScreen
import co.studio404.vpn.ui.theme.Theme
import co.studio404.vpn.ui.theme.VpnTheme

private enum class MainTab(val title: String, val icon: ImageVector) {
    Connection("Соединение", Icons.Filled.Shield),
    Stats("Статистика", Icons.Filled.BarChart),
    Settings("Настройки", Icons.Filled.Settings),
}

@Composable
fun VpnRoot(app: VpnApp) {
    val vm: AppViewModel = viewModel(factory = AppViewModel.factory(app))
    val ui by vm.ui.collectAsState()
    val status by vm.vpnStatus.collectAsState()
    var tabIndex by remember { mutableIntStateOf(0) }

    val vpnPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        vm.onVpnPermissionResult(result.resultCode == android.app.Activity.RESULT_OK)
    }

    LaunchedEffect(ui.pendingVpnPermission) {
        if (ui.pendingVpnPermission) {
            val intent = vm.pendingPermissionIntent
            if (intent != null) vpnPermissionLauncher.launch(intent)
        }
    }

    VpnTheme {
        if (!ui.hasToken) {
            RedeemScreen(
                busy = ui.busy,
                error = ui.errorMessage,
                onRedeem = vm::redeem,
            )
            return@VpnTheme
        }

        Scaffold(
            containerColor = Theme.bg,
            bottomBar = {
                NavigationBar(
                    containerColor = Theme.bgSoft,
                    contentColor = Theme.fg,
                ) {
                    MainTab.entries.forEachIndexed { index, tab ->
                        NavigationBarItem(
                            selected = tabIndex == index,
                            onClick = { tabIndex = index },
                            icon = { Icon(tab.icon, contentDescription = tab.title) },
                            label = { Text(tab.title) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Theme.accent,
                                selectedTextColor = Theme.accent,
                                unselectedIconColor = Theme.muted,
                                unselectedTextColor = Theme.muted,
                                indicatorColor = Theme.accentSoft,
                            ),
                        )
                    }
                }
            },
        ) { padding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                when (MainTab.entries[tabIndex]) {
                    MainTab.Connection -> DashboardScreen(
                        me = ui.me,
                        status = status,
                        busy = ui.busy,
                        error = ui.errorMessage,
                        dnsFilter = ui.dnsFilter,
                        dnsFilterAvailable = ui.dnsFilterAvailable,
                        autoConnectMode = ui.autoConnectMode,
                        liveStats = ui.liveStats,
                        speedHistory = ui.speedHistory,
                        onToggle = vm::onConnectClick,
                    )
                    MainTab.Stats -> StatsScreen(
                        sessions = ui.sessions,
                        onRefresh = vm::refreshSessions,
                    )
                    MainTab.Settings -> SettingsScreen(
                        me = ui.me,
                        busy = ui.busy,
                        dnsFilter = ui.dnsFilter,
                        dnsFilterAvailable = ui.dnsFilterAvailable,
                        autoConnectMode = ui.autoConnectMode,
                        trustedNetworks = ui.trustedNetworks,
                        error = ui.errorMessage,
                        onAutoConnect = vm::setAutoConnect,
                        onDnsFilter = vm::setDnsFilter,
                        onTrustedNetworks = vm::setTrustedNetworks,
                        onUnlink = {
                            vm.unlink()
                            tabIndex = 0
                        },
                    )
                }
            }
        }
    }
}
