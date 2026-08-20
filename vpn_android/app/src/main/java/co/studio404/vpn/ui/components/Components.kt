package co.studio404.vpn.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.studio404.vpn.stats.DailyTraffic
import co.studio404.vpn.ui.theme.Theme

@Composable
fun Eyebrow(text: String, color: Color = Theme.muted) {
    Text(
        text = text.uppercase(),
        color = color,
        fontFamily = FontFamily.Monospace,
        fontSize = 11.sp,
        letterSpacing = 1.5.sp,
    )
}

@Composable
fun CardBox(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Theme.surface, RoundedCornerShape(8.dp))
            .border(1.dp, Theme.border, RoundedCornerShape(8.dp))
            .padding(18.dp),
    ) {
        content()
    }
}

@Composable
fun StatCard(label: String, content: @Composable () -> Unit) {
    CardBox {
        Eyebrow(label)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
fun MiniStat(label: String, value: String, tint: Color = Theme.fg) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Theme.surface, RoundedCornerShape(8.dp))
            .border(1.dp, Theme.border, RoundedCornerShape(8.dp))
            .padding(14.dp),
    ) {
        Eyebrow(label)
        Spacer(Modifier.height(6.dp))
        Text(
            text = value,
            color = tint,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
            maxLines = 1,
        )
    }
}

@Composable
fun StatValue(text: String, unit: String? = null, size: Int = 32) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(
            text = text,
            color = Theme.fg,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.ExtraBold,
            fontSize = size.sp,
        )
        if (unit != null) {
            Text(
                text = unit,
                color = Theme.muted,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                modifier = Modifier.padding(start = 5.dp, bottom = 4.dp),
            )
        }
    }
}

@Composable
fun Sparkline(values: List<Double>, modifier: Modifier = Modifier) {
    val peak = (values.maxOrNull() ?: 1.0).coerceAtLeast(1.0)
    Canvas(modifier = modifier) {
        if (values.isEmpty()) return@Canvas
        val gap = 2.dp.toPx()
        val barWidth = 4.dp.toPx()
        val totalWidth = values.size * (barWidth + gap) - gap
        var x = (size.width - totalWidth).coerceAtLeast(0f)
        values.forEach { value ->
            val h = (size.height * (value / peak).toFloat()).coerceAtLeast(2f)
            drawRoundRect(
                color = Theme.accent.copy(alpha = 0.85f),
                topLeft = Offset(x, size.height - h),
                size = Size(barWidth, h),
                cornerRadius = CornerRadius(1f, 1f),
            )
            x += barWidth + gap
        }
    }
}

@Composable
fun TrafficBarChart(days: List<DailyTraffic>, modifier: Modifier = Modifier) {
    val peak = days.maxOfOrNull { it.totalBytes }?.toDouble()?.coerceAtLeast(1.0) ?: 1.0
    Canvas(modifier = modifier.fillMaxSize()) {
        if (days.isEmpty()) return@Canvas
        val gap = 6.dp.toPx()
        val barWidth = ((size.width - gap * (days.size - 1)) / days.size).coerceAtLeast(4f)
        days.forEachIndexed { index, day ->
            val h = (size.height * (day.totalBytes / peak)).toFloat().coerceAtLeast(2f)
            val x = index * (barWidth + gap)
            drawRoundRect(
                color = Theme.accent.copy(alpha = 0.85f),
                topLeft = Offset(x, size.height - h),
                size = Size(barWidth, h),
                cornerRadius = CornerRadius(2f, 2f),
            )
        }
    }
}
