import NetworkExtension
import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var vpn = VPNManager()

    private var isConnected: Bool { vpn.status == .connected }

    var body: some View {
        ZStack {
            GridBackground()
            VStack(spacing: 24) {
                header
                Spacer()
                connectButton
                Text(vpn.status.title.uppercased())
                    .font(Theme.mono(12))
                    .tracking(2.5)
                    .foregroundStyle(isConnected ? Theme.accent : Theme.muted)
                Spacer()
                balanceCard
                if let message = state.errorMessage {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
        }
        .preferredColorScheme(.dark)
        .task {
            await vpn.loadExisting()
            await state.refresh()
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 0) {
                Text("404").foregroundStyle(Theme.accent)
                Text("VPN").foregroundStyle(Theme.fg)
            }
            .font(.system(size: 20, weight: .heavy))
            Spacer()
            Eyebrow(text: state.me?.isSuspended == true ? "приостановлен" : "активен",
                    color: state.me?.isSuspended == true ? Theme.warn : Theme.accent)
        }
        .padding(.top, 8)
    }

    /// Кольцо подключения: в состоянии «подключено» светится акцентом.
    private var connectButton: some View {
        Button {
            Task { await toggle() }
        } label: {
            ZStack {
                Circle()
                    .strokeBorder(isConnected ? Theme.accent : Theme.borderStrong, lineWidth: 2)
                    .frame(width: 190, height: 190)
                Circle()
                    .fill(isConnected ? Theme.accentSoft : Theme.surface)
                    .frame(width: 168, height: 168)
                VStack(spacing: 6) {
                    Image(systemName: isConnected ? "bolt.fill" : "power")
                        .font(.system(size: 34, weight: .medium))
                        .foregroundStyle(isConnected ? Theme.accent : Theme.fgSoft)
                    Text(isConnected ? "Отключить" : "Подключить")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(isConnected ? Theme.accent : Theme.fg)
                }
            }
            .shadow(color: isConnected ? Theme.accentGlow : .clear, radius: 34)
        }
        .disabled(state.isBusy || vpn.status.isBusy)
        .opacity(state.isBusy || vpn.status.isBusy ? 0.6 : 1)
    }

    private var balanceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "баланс")
            Text("\(state.me?.balance ?? "—") ₽")
                .font(.system(size: 32, weight: .heavy, design: .monospaced))
                .foregroundStyle(Theme.fg)
            Text(subtitle)
                .font(Theme.mono(12))
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var subtitle: String {
        guard let me = state.me else { return "загружаем…" }
        guard let days = me.daysLeft else { return "без списаний · нет устройств" }
        return "≈ \(days) дн. · устройств: \(me.devices)"
    }

    private func toggle() async {
        if isConnected {
            vpn.disconnect()
            return
        }
        // конфиг всегда берём свежий: сервер мог отключить пир при нулевом балансе
        guard await state.installTunnel(into: vpn) else { return }
        do {
            try vpn.connect()
        } catch {
            state.errorMessage = "Не удалось запустить туннель"
        }
    }
}

#Preview {
    HomeView().environmentObject(AppState())
}
