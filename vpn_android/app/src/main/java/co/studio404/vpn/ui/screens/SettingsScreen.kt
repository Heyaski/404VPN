package co.studio404.vpn.ui.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.studio404.vpn.data.MeResponse
import co.studio404.vpn.prefs.AutoConnectMode
import co.studio404.vpn.stats.TrafficFormatter
import co.studio404.vpn.ui.components.StatCard
import co.studio404.vpn.ui.theme.GridBackground
import co.studio404.vpn.ui.theme.Theme

@Composable
fun SettingsScreen(
    me: MeResponse?,
    busy: Boolean,
    dnsFilter: Boolean,
    dnsFilterAvailable: Boolean,
    autoConnectMode: AutoConnectMode,
    trustedNetworks: List<String>,
    error: String?,
    onAutoConnect: (AutoConnectMode) -> Unit,
    onDnsFilter: (Boolean) -> Unit,
    onTrustedNetworks: (List<String>) -> Unit,
    onUnlink: () -> Unit,
) {
    var confirmUnlink by remember { mutableStateOf(false) }
    var newNetwork by remember { mutableStateOf("") }

    GridBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatCard("автоподключение") {
                AutoConnectMode.entries.forEachIndexed { index, mode ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onAutoConnect(mode) }
                            .padding(vertical = 11.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            mode.title,
                            color = if (mode == autoConnectMode) Theme.fg else Theme.fgSoft,
                            fontSize = 14.sp,
                        )
                        if (mode == autoConnectMode) {
                            Text("✓", color = Theme.accent, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (index != AutoConnectMode.entries.lastIndex) {
                        HorizontalDivider(color = Theme.border)
                    }
                }
                if (autoConnectMode != AutoConnectMode.OFF && me?.isSuspended == true) {
                    Text(
                        "Пока баланс на нуле, автоподключение отключено: туннель всё равно не поднимется.",
                        color = Theme.warn,
                        fontSize = 12.sp,
                    )
                }
            }

            StatCard("доверенные сети") {
                Text(
                    "В этих сетях туннель поднимать не нужно. Имя вводится вручную — так приложению не требуется доступ к геопозиции.",
                    color = Theme.muted,
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(8.dp))
                trustedNetworks.forEach { network ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(network, color = Theme.fg, fontSize = 14.sp)
                        TextButton(
                            onClick = { onTrustedNetworks(trustedNetworks.filterNot { it == network }) },
                        ) {
                            Text("−", color = Theme.danger, fontSize = 18.sp)
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    BasicTextField(
                        value = newNetwork,
                        onValueChange = { newNetwork = it },
                        singleLine = true,
                        cursorBrush = SolidColor(Theme.accent),
                        textStyle = TextStyle(color = Theme.fg, fontSize = 14.sp),
                        modifier = Modifier
                            .weight(1f)
                            .border(1.dp, Theme.borderStrong, RoundedCornerShape(8.dp))
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        decorationBox = { inner ->
                            if (newNetwork.isEmpty()) {
                                Text("Имя сети", color = Theme.muted, fontSize = 14.sp)
                            }
                            inner()
                        },
                    )
                    TextButton(
                        onClick = {
                            val name = newNetwork.trim()
                            if (name.isNotEmpty() && name !in trustedNetworks) {
                                onTrustedNetworks(trustedNetworks + name)
                                newNetwork = ""
                            }
                        },
                        enabled = newNetwork.trim().isNotEmpty(),
                    ) {
                        Text("Добавить", color = Theme.accent, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            StatCard("защита") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Блокировать рекламу и трекеры", color = Theme.fg, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Switch(
                        checked = dnsFilter,
                        onCheckedChange = onDnsFilter,
                        enabled = dnsFilterAvailable && !busy,
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = Theme.accent,
                            checkedThumbColor = Theme.accentContrast,
                        ),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    when {
                        !dnsFilterAvailable -> "Фильтр пока не настроен на сервере."
                        busy -> "Переподключаем туннель…"
                        else -> "Реклама и трекеры отсекаются на уровне DNS. Переключение меняет настройки соединения, поэтому туннель на пару секунд переподключится."
                    },
                    color = if (busy && dnsFilterAvailable) Theme.accent else Theme.muted,
                    fontSize = 12.sp,
                )
            }

            StatCard("устройство") {
                if (me != null) {
                    Text(me.deviceName ?: "это устройство", color = Theme.fg, fontSize = 14.sp)
                    Text(
                        "баланс ${TrafficFormatter.money(me.balance)} ₽",
                        color = Theme.muted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                    Spacer(Modifier.height(12.dp))
                }
                if (!confirmUnlink) {
                    TextButton(onClick = { confirmUnlink = true }, enabled = !busy) {
                        Text("Отвязать устройство", color = Theme.muted)
                    }
                } else {
                    Text(
                        "Устройство отвяжется, списание за него прекратится. Чтобы вернуться, понадобится новый код из бота.",
                        color = Theme.muted,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        TextButton(
                            onClick = { confirmUnlink = false },
                            enabled = !busy,
                            modifier = Modifier
                                .weight(1f)
                                .border(1.dp, Theme.borderStrong, RoundedCornerShape(8.dp)),
                        ) {
                            Text("Отмена", color = Theme.fgSoft)
                        }
                        TextButton(
                            onClick = onUnlink,
                            enabled = !busy,
                            modifier = Modifier
                                .weight(1f)
                                .border(1.dp, Theme.danger, RoundedCornerShape(8.dp)),
                        ) {
                            Text(if (busy) "Отвязка…" else "Отвязать", color = Theme.danger)
                        }
                    }
                }
            }

            StatCard("о приложении") {
                Text("404VPN Android 1.0.0", color = Theme.muted, fontFamily = FontFamily.Monospace, fontSize = 11.sp)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Приложение не запрашивает геопозицию, контакты и фотографии.",
                    color = Theme.muted,
                    fontSize = 12.sp,
                )
            }

            if (error != null) {
                Text(error, color = Theme.danger, fontSize = 13.sp)
            }
        }
    }
}
