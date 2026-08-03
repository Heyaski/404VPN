import NetworkExtension
import WireGuardKit
import os

/// Расширение туннеля: поднимает WireGuard по конфигурации, которую положило приложение,
/// и попутно ведёт статистику — счётчики знает только этот процесс.
class PacketTunnelProvider: NEPacketTunnelProvider {
    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { logLevel, message in
            NSLog("[Overlay] \(logLevel): \(message)")
        }
    }()

    private lazy var collector: StatsCollector? = {
        guard let store = StatsStore.shared else { return nil }
        return StatsCollector(store: store) { [weak self] in
            await self?.runtimeConfiguration()
        }
    }()

    /// Счётчики из адаптера в виде UAPI-строки.
    private func runtimeConfiguration() async -> String? {
        await withCheckedContinuation { continuation in
            adapter.getRuntimeConfiguration { continuation.resume(returning: $0) }
        }
    }

    override func startTunnel(options: [String: NSObject]?) async throws {
        guard
            let proto = protocolConfiguration as? NETunnelProviderProtocol,
            let wgQuickConfig = proto.providerConfiguration?["wgQuickConfig"] as? String
        else {
            throw PacketTunnelProviderError.missingConfiguration
        }

        guard let configuration = try? TunnelConfiguration(fromWgQuickConfig: wgQuickConfig, called: "Overlay") else {
            throw PacketTunnelProviderError.invalidConfiguration
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            adapter.start(tunnelConfiguration: configuration) { error in
                if let error {
                    NSLog("[Overlay] не удалось поднять туннель: \(error)")
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }

        collector?.start()
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        await collector?.stop()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            adapter.stop { _ in continuation.resume() }
        }
    }

    /// Приложение спрашивает счётчики, пока открыт экран статистики.
    override func handleAppMessage(_ messageData: Data) async -> Data? {
        guard String(data: messageData, encoding: .utf8) == TunnelMessage.stats else { return nil }
        guard let stats = await collector?.currentStats() else { return nil }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try? encoder.encode(stats)
    }
}

enum PacketTunnelProviderError: Error {
    case missingConfiguration
    case invalidConfiguration
}
