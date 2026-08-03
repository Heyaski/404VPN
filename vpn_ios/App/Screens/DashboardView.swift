import NetworkExtension
import SwiftUI

/// Приборная панель: состояние туннеля, живой трафик, режимы, баланс.
struct DashboardView: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var vpn: VPNManager

    @State private var stats: TunnelStats = .empty
    @State private var speedHistory: [Double] = []

    private var isConnected: Bool { vpn.status == .connected }

    var body: some View {
        ZStack {
            GridBackground()
            ScrollView {
                VStack(spacing: 12) {
                    header
                    connectButton
                    if state.me?.isSuspended == true { suspendedNotice }
                    if isConnected { trafficCard }
                    modeRow
                    balanceCard
                    if let message = state.errorMessage { errorText(message) }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .task {
            await state.refresh()
            await state.syncProfileWithAccount(vpn: vpn)
            stats = StatsStore.shared?.readSnapshot() ?? .empty
        }
        .task(id: vpn.status) { await pollStats() }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 0) {
                Text("404").foregroundStyle(Theme.accent)
                Text("/OVERLAY").foregroundStyle(Theme.fg)
            }
            .font(.system(size: 18, weight: .heavy))
            Spacer()
            Eyebrow(text: statusLabel, color: statusColor)
        }
        .padding(.top, 8)
    }

    private var statusLabel: String {
        if state.me?.isSuspended == true { return "приостановлен" }
        return isConnected ? "защищено" : "не защищено"
    }

    private var statusColor: Color {
        if state.me?.isSuspended == true { return Theme.warn }
        return isConnected ? Theme.accent : Theme.muted
    }

    /// Широкая кнопка вместо круглой: круг со свечением — самый копируемый
    /// VPN-интерфейс, из-за него в том числе и прилетел отказ по 4.3.
    private var connectButton: some View {
        Button {
            Task { await toggle() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isConnected ? "bolt.fill" : "power")
                Text(isConnected ? "Отключить" : "Подключить")
                    .font(.system(size: 16, weight: .bold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .foregroundStyle(isConnected ? Theme.accent : Theme.fg)
            .background(isConnected ? Theme.accentSoft : Theme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .strokeBorder(isConnected ? Theme.accent : Theme.borderStrong, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .disabled(state.isBusy || vpn.status.isBusy || state.me?.isSuspended == true)
        .opacity(state.isBusy || vpn.status.isBusy ? 0.6 : 1)
    }

    private var suspendedNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "доступ приостановлен", color: Theme.warn)
            Text("Баланс закончился. Пополните его в боте — доступ вернётся, а автоподключение включится обратно.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var trafficCard: some View {
        StatCard(label: "трафик сейчас") {
            StatValue(text: TrafficFormatter.bytes(UInt64(currentSpeed)), unit: "/с")
            Sparkline(values: speedHistory)
                .frame(height: 34)
        }
    }

    private var modeRow: some View {
        HStack(spacing: 10) {
            MiniStat(label: "автовкл",
                     value: Preferences.shared.autoConnectMode.title,
                     tint: Preferences.shared.autoConnectMode == .off ? Theme.muted : Theme.accent)
            MiniStat(label: "принято",
                     value: TrafficFormatter.bytes(stats.rxBytes))
        }
    }

    private var balanceCard: some View {
        StatCard(label: "баланс") {
            StatValue(text: state.me.map { TrafficFormatter.money($0.balance) } ?? "—", unit: "₽")
            Text(balanceSubtitle)
                .font(Theme.mono(12))
                .foregroundStyle(Theme.muted)
        }
    }

    private var balanceSubtitle: String {
        guard let me = state.me else { return "загружаем…" }
        guard let days = me.daysLeft else { return "без списаний · нет устройств" }
        return "≈ \(days) дн. · устройств: \(me.devices)"
    }

    private func errorText(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 13))
            .foregroundStyle(Theme.danger)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var currentSpeed: Double { speedHistory.last ?? 0 }

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

    /// Живой график: раз в секунду спрашиваем расширение напрямую.
    /// Цикл живёт, только пока туннель поднят, — task(id:) перезапускает его при смене статуса.
    private func pollStats() async {
        guard isConnected else { return }
        var previous = stats
        while !Task.isCancelled && vpn.status == .connected {
            if let fresh = await vpn.requestStats() {
                let elapsed = fresh.capturedAt.timeIntervalSince(previous.capturedAt)
                if elapsed > 0 {
                    let delta = Double(fresh.rxBytes &+ fresh.txBytes)
                        - Double(previous.rxBytes &+ previous.txBytes)
                    speedHistory.append(max(0, delta / elapsed))
                    if speedHistory.count > 24 { speedHistory.removeFirst() }
                }
                previous = fresh
                stats = fresh
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }
}

/// Столбики скорости — без Charts, чтобы дашборд оставался лёгким.
struct Sparkline: View {
    let values: [Double]

    var body: some View {
        GeometryReader { geometry in
            let peak = max(values.max() ?? 1, 1)
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Theme.accent.opacity(0.85))
                        .frame(height: max(2, geometry.size.height * value / peak))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}
