package co.studio404.vpn.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.studio404.vpn.stats.SessionRecord
import co.studio404.vpn.stats.StatsAggregator
import co.studio404.vpn.stats.StatsPeriod
import co.studio404.vpn.stats.TrafficFormatter
import co.studio404.vpn.ui.components.CardBox
import co.studio404.vpn.ui.components.MiniStat
import co.studio404.vpn.ui.components.StatCard
import co.studio404.vpn.ui.components.TrafficBarChart
import co.studio404.vpn.ui.theme.GridBackground
import co.studio404.vpn.ui.theme.Theme
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun StatsScreen(
    sessions: List<SessionRecord>,
    onRefresh: () -> Unit,
) {
    var period by remember { mutableStateOf(StatsPeriod.WEEK) }
    LaunchedEffect(Unit) { onRefresh() }

    val visible = remember(sessions, period) { StatsAggregator.sessions(sessions, period) }
    val days = remember(visible) { StatsAggregator.byDay(visible) }
    val newestFirst = remember(visible) { visible.sortedByDescending { it.startedAtMs } }
    val dateFmt = remember { SimpleDateFormat("d MMM, HH:mm", Locale("ru")) }

    GridBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PeriodPicker(period = period, onSelect = { period = it })

            if (visible.isEmpty()) {
                CardBox {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Пока нечего показать",
                            color = Theme.fg,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            "Данные появятся после первого подключения: приложение считает трафик само, на устройстве.",
                            color = Theme.muted,
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            } else {
                StatCard("трафик по дням") {
                    TrafficBarChart(
                        days = days,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(150.dp),
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        MiniStat(
                            label = "принято",
                            value = TrafficFormatter.bytes(visible.sumOf { it.rxBytes }),
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        MiniStat(
                            label = "отдано",
                            value = TrafficFormatter.bytes(visible.sumOf { it.txBytes }),
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        MiniStat(
                            label = "под защитой",
                            value = TrafficFormatter.duration(
                                visible.sumOf { it.durationMs() } / 1000,
                            ),
                        )
                    }
                }

                StatCard("подключения") {
                    newestFirst.forEachIndexed { index, session ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 9.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column {
                                Text(
                                    dateFmt.format(Date(session.startedAtMs)),
                                    color = Theme.fg,
                                    fontSize = 13.sp,
                                )
                                Text(
                                    TrafficFormatter.duration(session.durationMs() / 1000),
                                    color = Theme.muted,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 10.sp,
                                )
                            }
                            Text(
                                TrafficFormatter.bytes(session.totalBytes),
                                color = Theme.fgSoft,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp,
                            )
                        }
                        if (index != newestFirst.lastIndex) {
                            HorizontalDivider(color = Theme.border)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PeriodPicker(period: StatsPeriod, onSelect: (StatsPeriod) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .background(Theme.surface, RoundedCornerShape(8.dp))
            .border(1.dp, Theme.border, RoundedCornerShape(8.dp))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        StatsPeriod.entries.forEach { option ->
            val selected = option == period
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(36.dp)
                    .background(
                        if (selected) Theme.accent else Theme.surface,
                        RoundedCornerShape(6.dp),
                    )
                    .clickable { onSelect(option) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = option.title,
                    color = if (selected) Theme.accentContrast else Theme.fgSoft,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                )
            }
        }
    }
}
