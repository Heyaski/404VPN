package co.studio404.vpn.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.studio404.vpn.data.CodeFormatter
import co.studio404.vpn.ui.theme.GridBackground
import co.studio404.vpn.ui.theme.Theme

@Composable
fun RedeemScreen(
    busy: Boolean,
    error: String?,
    onRedeem: (String) -> Unit,
) {
    var codeField by remember { mutableStateOf(TextFieldValue("")) }
    val code = codeField.text
    val complete = CodeFormatter.isComplete(code)

    GridBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "ИНЖЕНЕРНАЯ СТУДИЯ",
                style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                color = Theme.accent,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "404VPN",
                fontSize = 36.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Theme.fg,
            )
            Text(
                text = "Введи код из Telegram Mini App",
                color = Theme.muted,
                modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
            )

            OutlinedTextField(
                value = codeField,
                onValueChange = { next ->
                    val (formatted, cursor) = CodeFormatter.formatWithCursor(
                        next.text,
                        next.selection.end,
                    )
                    codeField = TextFieldValue(
                        text = formatted,
                        selection = TextRange(cursor),
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = !busy,
                placeholder = { Text("XXXX-XXXX-XXXX-XXXX", color = Theme.muted) },
                textStyle = androidx.compose.ui.text.TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 18.sp,
                    color = Theme.fg,
                    letterSpacing = 1.sp,
                ),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(
                    onDone = { if (complete && !busy) onRedeem(code) },
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Theme.accent,
                    unfocusedBorderColor = Theme.borderStrong,
                    cursorColor = Theme.accent,
                    focusedContainerColor = Theme.surface,
                    unfocusedContainerColor = Theme.surface,
                ),
                shape = RoundedCornerShape(8.dp),
            )

            Spacer(Modifier.height(16.dp))

            Button(
                onClick = { onRedeem(code) },
                enabled = complete && !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Theme.accent,
                    contentColor = Theme.accentContrast,
                    disabledContainerColor = Theme.accent.copy(alpha = 0.35f),
                    disabledContentColor = Theme.accentContrast.copy(alpha = 0.6f),
                ),
            ) {
                Text(
                    text = if (busy) "Активация…" else "Активировать",
                    fontWeight = FontWeight.Bold,
                )
            }

            if (error != null) {
                Text(
                    text = error,
                    color = Theme.danger,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}
