import Foundation
import NetworkExtension

/// Управляет системным VPN-профилем: устанавливает конфигурацию туннеля,
/// поднимает и опускает соединение, следит за статусом.
@MainActor
final class VPNManager: ObservableObject {
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
    func install(config: TunnelConfig) async throws {
        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        let target = managers.first ?? NETunnelProviderManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "co.404studio.vpn.tunnel"
        proto.serverAddress = config.peer.endpoint
        // Конфиг лежит в системном хранилище профиля, а не в файлах приложения
        proto.providerConfiguration = ["wgQuickConfig": config.wgQuickConfig]

        target.protocolConfiguration = proto
        target.localizedDescription = "404VPN"
        target.isEnabled = true

        try await target.saveToPreferences()
        // Перечитываем: после сохранения система выдаёт актуальный объект
        try await target.loadFromPreferences()

        manager = target
        status = target.connection.status
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
