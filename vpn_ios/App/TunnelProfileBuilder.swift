import Foundation

/// Что именно записать в системный профиль туннеля.
struct TunnelProfileSettings: Equatable {
    var serverAddress: String
    var wgQuickConfig: String
    var includeAllNetworks: Bool
    var onDemandEnabled: Bool
}

/// Решение отделено от его применения: `VPNManager` только раскладывает эти значения
/// по `NETunnelProviderManager`, а сама логика проверяется тестом.
enum TunnelProfileBuilder {
    static func settings(config: TunnelConfig,
                         autoConnect: AutoConnectMode,
                         accountSuspended: Bool,
                         dnsFilter: Bool) -> TunnelProfileSettings {
        TunnelProfileSettings(
            // поле только для показа: адрес подключения система берёт из конфигурации WireGuard
            serverAddress: VPNManager.displayName,
            wgQuickConfig: config.wgQuick(filtered: dnsFilter),
            // Всегда false, и это не формальность. Флаг загоняет в туннель весь трафик
            // независимо от маршрутов, то есть убивает обход российских сервисов.
            // Он живёт в сохранённом профиле, поэтому у тех, кто включал kill switch
            // до обновления, его надо явно погасить.
            includeAllNetworks: false,
            // при исчерпанном балансе сервер выключает пир: туннель не поднимется никогда,
            // а правила будут блокировать трафик — человек останется вообще без интернета
            onDemandEnabled: autoConnect != .off && !accountSuspended)
    }
}
