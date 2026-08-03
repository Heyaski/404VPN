import SwiftUI

/// Три вкладки. Менеджер VPN создаётся здесь в единственном экземпляре:
/// иначе каждая вкладка завела бы свой и статусы разъехались бы.
struct RootView: View {
    @StateObject private var vpn = VPNManager()

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Соединение", systemImage: "shield.lefthalf.filled") }
            StatsView()
                .tabItem { Label("Статистика", systemImage: "chart.bar.fill") }
            SettingsView()
                .tabItem { Label("Настройки", systemImage: "gearshape.fill") }
        }
        .environmentObject(vpn)
        .tint(Theme.accent)
        .preferredColorScheme(.dark)
        .task { await vpn.loadExisting() }
    }
}
