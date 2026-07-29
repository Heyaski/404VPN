import SwiftUI

/// Экран активации: единственный способ попасть в приложение.
/// Никаких кнопок оплаты и ссылок наружу — требование App Store Guideline 3.1.1.
struct RedeemView: View {
    @EnvironmentObject private var state: AppState
    @State private var code = ""
    @FocusState private var focused: Bool

    private var isComplete: Bool { CodeFormatter.isComplete(code) }

    var body: some View {
        ZStack {
            GridBackground()
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)

                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow(text: "инженерная студия 404", color: Theme.accent)
                    HStack(spacing: 0) {
                        Text("404").foregroundStyle(Theme.accent)
                        Text("VPN").foregroundStyle(Theme.fg)
                    }
                    .font(.system(size: 40, weight: .heavy))
                    .tracking(-1)
                }

                Text("Введи код доступа — он придёт в Telegram после пополнения баланса.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.fgSoft)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 12) {
                    Eyebrow(text: "код доступа")
                    TextField("XXXX-XXXX-XXXX-XXXX", text: $code)
                        .font(Theme.mono(18, weight: .medium))
                        .foregroundStyle(Theme.fg)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .focused($focused)
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.radius)
                                .fill(Theme.surface2)
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.radius)
                                        .strokeBorder(
                                            focused ? Theme.accent : Theme.borderStrong,
                                            lineWidth: 1
                                        )
                                )
                        )
                        .onChange(of: code) { newValue in
                            let formatted = CodeFormatter.format(newValue)
                            if formatted != newValue { code = formatted }
                        }
                }

                if let message = state.errorMessage {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    focused = false
                    Task { await state.redeem(code: code) }
                } label: {
                    Text(state.isBusy ? "Активируем…" : "Активировать")
                }
                .buttonStyle(PrimaryButtonStyle(enabled: isComplete && !state.isBusy))
                .disabled(!isComplete || state.isBusy)

                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    RedeemView().environmentObject(AppState())
}
