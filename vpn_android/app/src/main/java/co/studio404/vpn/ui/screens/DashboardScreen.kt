package co.studio404.vpn.ui.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.studio404.vpn.data.MeResponse
import co.studio404.vpn.prefs.AutoConnectMode
import co.studio404.vpn.stats.TrafficFormatter
import co.studio404.vpn.stats.TunnelStats
import co.studio404.vpn.ui.components.Eyebrow
import co.studio404.vpn.ui.components.MiniStat
import co.studio404.vpn.ui.components.Sparkline
import co.studio404.vpn.ui.components.StatCard
import co.studio404.vpn.ui.components.StatValue
import co.studio404.vpn.ui.theme.GridBackground
import co.studio404.vpn.ui.theme.Theme
import co.studio404.vpn.vpn.VpnStatus

@Composable
fun DashboardScreen(
    me: MeResponse?,
    status: VpnStatus,
    busy: Boolean,
    error: String?,
    dnsFilter: Boolean,
    dnsFilterAvailable: Boolean,
    autoConnectMode: AutoConnectMode,
    liveStats: TunnelStats,
    speedHistory: List<Double>,
    onToggle: () -> Unit,
) {
    val suspended = me?.isSuspended == true
    val connected = status == VpnStatus.CONNECTED
    val pending = busy || status == VpnStatus.CONNECTING || status == VpnStatus.DISCONNECTING

    val statusText = when {
        suspended -> "приостановлен"
        status == VpnStatus.CONNECTING -> "подключение"
        status == VpnStatus.DISCONNECTING -> "отключение"
        connected -> "защищено"
        status == VpnStatus.ERROR -> "ошибка"
        else -> "не защищено"
    }
    val statusColor = when {
        suspended -> Theme.warn
        connected -> Theme.accent
        status == VpnStatus.ERROR -> Theme.warn
        else -> Theme.muted
    }
    val buttonText = when {
        status == VpnStatus.CONNECTING -> "Подключение…"
        status == VpnStatus.DISCONNECTING -> "Отключение…"
        connected -> "Отключить"
        busy -> "Подождите…"
        else -> "Подключить"
    }
    val filterLabel = when {
        !dnsFilterAvailable -> "недоступен"
        dnsFilter -> "включён"
        else -> "выключен"
    }
    val currentSpeed = speedHistory.lastOrNull() ?: 0.0

    GridBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = Theme.accent, fontWeight = FontWeight.ExtraBold)) {
                            append("404")
                        }
                        withStyle(SpanStyle(color = Theme.fg, fontWeight = FontWeight.ExtraBold)) {
                            append("/OVERLAY")
                        }
                    },
                    fontSize = 18.sp,
                )
                Text(
                    text = statusText.uppercase(),
                    color = statusColor,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    letterSpacing = 1.5.sp,
                )
            }

            Button(
                onClick = onToggle,
                enabled = !pending && !suspended,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .border(
                        width = 1.dp,
                        color = if (connected) Theme.accent else Theme.borderStrong,
                        shape = RoundedCornerShape(8.dp),
                    ),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (connected) Theme.accentSoft else Theme.surface,
                    contentColor = if (connected) Theme.accent else Theme.fg,
                    disabledContainerColor = Theme.surface.copy(alpha = 0.7f),
                    disabledContentColor = Theme.fg.copy(alpha = 0.5f),
                ),
            ) {
                if (pending) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .padding(end = 10.dp)
                            .size(18.dp),
                        strokeWidth = 2.dp,
                        color = Theme.accent,
                    )
                } else {
                    Icon(
                        imageVector = if (connected) Icons.Filled.Bolt else Icons.Filled.PowerSettingsNew,
                        contentDescription = null,
                        modifier = Modifier
                            .padding(end = 10.dp)
                            .size(20.dp),
                    )
                }
                Text(buttonText, fontWeight = FontWeight.Bold)
            }

            if (suspended) {
                StatCard("доступ приостановлен") {
                    Text(
                        "Баланс закончился. Пополните его в боте — доступ вернётся, а автоподключение включится обратно.",
                        color = Theme.muted,
                        fontSize = 13.sp,
                    )
                }
            }

            if (connected) {
                StatCard("трафик сейчас") {
                    StatValue(text = TrafficFormatter.bytes(currentSpeed.toLong()), unit = "/с")
                    Spacer(Modifier.height(8.dp))
                    Sparkline(
                        values = speedHistory,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(34.dp),
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    MiniStat(
                        label = "автовкл",
                        value = autoConnectMode.title,
                        tint = if (autoConnectMode == AutoConnectMode.OFF) Theme.muted else Theme.accent,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    MiniStat(
                        label = "фильтр",
                        value = filterLabel,
                        tint = if (dnsFilter) Theme.accent else Theme.muted,
                    )
                }
            }

            StatCard("баланс") {
                StatValue(
                    text = me?.let { TrafficFormatter.money(it.balance) } ?: "—",
                    unit = "₽",
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = when {
                        me == null -> "загружаем…"
                        me.daysLeft != null -> "≈ ${me.daysLeft} дн. · устройств: ${me.devices}"
                        else -> "без списаний · нет устройств"
                    },
                    color = Theme.muted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                )
            }

            if (error != null) {
                Text(error, color = Theme.danger, fontSize = 13.sp)
            }
        }
    }
}
