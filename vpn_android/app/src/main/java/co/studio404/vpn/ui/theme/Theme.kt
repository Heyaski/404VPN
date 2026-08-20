package co.studio404.vpn.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Theme {
    val bg = Color(0xFF070B14)
    val bgSoft = Color(0xFF0B1120)
    val surface = Color(0xFF0F1626)
    val surface2 = Color(0xFF141D31)
    val border = Color.White.copy(alpha = 0.08f)
    val borderStrong = Color.White.copy(alpha = 0.15f)
    val fg = Color(0xFFF3F6FC)
    val fgSoft = Color(0xFFC3CCDB)
    val muted = Color(0xFF8593A8)
    val accent = Color(0xFF34D399)
    val accentStrong = Color(0xFF10B981)
    val accentContrast = Color(0xFF04150D)
    val accentSoft = Color(0xFF34D399).copy(alpha = 0.12f)
    val accentGlow = Color(0xFF34D399).copy(alpha = 0.28f)
    val warn = Color(0xFFF59E0B)
    val danger = Color(0xFFEF4444)
    val gridLine = Color.White.copy(alpha = 0.035f)
}

private val colorScheme = darkColorScheme(
    primary = Theme.accent,
    onPrimary = Theme.accentContrast,
    background = Theme.bg,
    onBackground = Theme.fg,
    surface = Theme.surface,
    onSurface = Theme.fg,
    error = Theme.danger,
)

@Composable
fun VpnTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = colorScheme,
        typography = MaterialTheme.typography.copy(
            headlineLarge = TextStyle(
                fontWeight = FontWeight.ExtraBold,
                fontSize = 32.sp,
                color = Theme.fg,
            ),
            titleLarge = TextStyle(
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
                color = Theme.fg,
            ),
            bodyLarge = TextStyle(
                fontSize = 16.sp,
                color = Theme.fg,
            ),
            bodyMedium = TextStyle(
                fontSize = 14.sp,
                color = Theme.fgSoft,
            ),
            labelSmall = TextStyle(
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                letterSpacing = 1.5.sp,
                color = Theme.muted,
            ),
        ),
        content = content,
    )
}

@Composable
fun GridBackground(content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Theme.bg),
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val step = 32.dp.toPx()
            var x = 0f
            while (x <= size.width) {
                drawLine(Theme.gridLine, Offset(x, 0f), Offset(x, size.height), 1f)
                x += step
            }
            var y = 0f
            while (y <= size.height) {
                drawLine(Theme.gridLine, Offset(0f, y), Offset(size.width, y), 1f)
                y += step
            }
        }
        content()
    }
}

fun accentGlowShadow() = Shadow(
    color = Theme.accentGlow,
    offset = Offset(0f, 6f),
    blurRadius = 18f,
)
