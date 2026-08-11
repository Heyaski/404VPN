import Foundation
import NetworkExtension

/// Управляет системным VPN-профилем: устанавливает конфигурацию туннеля,
/// поднимает и опускает соединение, следит за статусом.
@MainActor
final class VPNManager: ObservableObject {
    /// Имя профиля в «Настройки → Основные → VPN и управление устройством».
    static let displayName = "Overlay"

    @Published private(set) var status: NEVPNStatus = .invalid

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange, object: nil, queue: .main
        ) { [weak self] notification in
            guard let session = notification.object as? NEVPNConnection else { return }
            Task { @MainActor in self?.status = session.status }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Загружает существующий профиль, если он уже был создан ранее.
    func loadExisting() async {
        let managers = try? await NETunnelProviderManager.loadAllFromPreferences()
        manager = managers?.first
        status = manager?.connection.status ?? .invalid
    }

    /// Создаёт или обновляет профиль туннеля из конфигурации, полученной с бэкенда.
    func install(config: TunnelConfig,
                 killSwitch: Bool,
                 autoConnect: AutoConnectMode,
                 trustedNetworks: [String],
                 accountSuspended: Bool,
                 dnsFilter: Bool) async throws {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: killSwitch,
                                                     autoConnect: autoConnect,
                                                     accountSuspended: accountSuspended,
                                                     dnsFilter: dnsFilter)

        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        let target = managers.first ?? NETunnelProviderManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "co.404studio.vpn.tunnel"
        // Только для показа в системных настройках: адрес подключения система берёт
        // из конфигурации WireGuard внутри providerConfiguration, а не отсюда.
        // Поэтому здесь имя приложения, а не IP сервера.
        proto.serverAddress = settings.serverAddress
        proto.includeAllNetworks = settings.includeAllNetworks
        // Конфиг лежит в системном хранилище профиля, а не в файлах приложения
        proto.providerConfiguration = ["wgQuickConfig": settings.wgQuickConfig]

        target.protocolConfiguration = proto
        target.localizedDescription = Self.displayName
        target.onDemandRules = OnDemandRules.rules(mode: autoConnect, trustedNetworks: trustedNetworks)
        target.isOnDemandEnabled = settings.onDemandEnabled
        target.isEnabled = true

        try await target.saveToPreferences()
        // Перечитываем: после сохранения система выдаёт актуальный объект
        try await target.loadFromPreferences()

        manager = target
        status = target.connection.status
    }

    /// Обновляет правила и защиту у уже установленного профиля, не трогая конфигурацию.
    /// Нужно, когда человек поменял настройки или когда баланс ушёл в ноль.
    func applyPreferences(autoConnect: AutoConnectMode,
                          trustedNetworks: [String],
                          killSwitch: Bool,
                          accountSuspended: Bool) async {
        guard let manager else { return }
        (manager.protocolConfiguration as? NETunnelProviderProtocol)?.includeAllNetworks = killSwitch
        manager.onDemandRules = OnDemandRules.rules(mode: autoConnect, trustedNetworks: trustedNetworks)
        manager.isOnDemandEnabled = autoConnect != .off && !accountSuspended
        try? await manager.saveToPreferences()
        try? await manager.loadFromPreferences()
    }

    /// Спрашивает у расширения текущие счётчики. Работает только пока туннель поднят.
    func requestStats() async -> TunnelStats? {
        guard let session = manager?.connection as? NETunnelProviderSession,
              let request = TunnelMessage.stats.data(using: .utf8)
        else { return nil }

        return await withCheckedContinuation { continuation in
            do {
                try session.sendProviderMessage(request) { response in
                    guard let response else { return continuation.resume(returning: nil) }
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = .iso8601
                    continuation.resume(returning: try? decoder.decode(TunnelStats.self, from: response))
                }
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }

    func connect() throws {
        guard let manager else { throw ApiError.network("Профиль VPN не установлен") }
        try manager.connection.startVPNTunnel()
    }

    func disconnect() {
        manager?.connection.stopVPNTunnel()
    }

    /// Удаляет профиль из системных настроек — при отвязке устройства.
    func removeProfile() async {
        guard let manager else { return }
        try? await manager.removeFromPreferences()
        self.manager = nil
        status = .invalid
    }
}

extension NEVPNStatus {
    var title: String {
        switch self {
        case .connected: return "подключено"
        case .connecting: return "подключение"
        case .disconnecting: return "отключение"
        case .reasserting: return "переподключение"
        case .disconnected, .invalid: return "отключено"
        @unknown default: return "отключено"
        }
    }

    var isBusy: Bool {
        self == .connecting || self == .disconnecting || self == .reasserting
    }
}
