import NetworkExtension
import WireGuardKit
import os

/// Расширение туннеля: поднимает WireGuard по конфигурации, которую положило приложение.
class PacketTunnelProvider: NEPacketTunnelProvider {
    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { logLevel, message in
            NSLog("[404VPN] \(logLevel): \(message)")
        }
    }()

    override func startTunnel(options: [String: NSObject]?) async throws {
        guard
            let proto = protocolConfiguration as? NETunnelProviderProtocol,
            let wgQuickConfig = proto.providerConfiguration?["wgQuickConfig"] as? String
        else {
            throw PacketTunnelProviderError.missingConfiguration
        }

        guard let configuration = try? TunnelConfiguration(fromWgQuickConfig: wgQuickConfig, called: "404VPN") else {
            throw PacketTunnelProviderError.invalidConfiguration
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            adapter.start(tunnelConfiguration: configuration) { error in
                if let error {
                    NSLog("[404VPN] не удалось поднять туннель: \(error)")
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            adapter.stop { _ in continuation.resume() }
        }
    }
}

enum PacketTunnelProviderError: Error {
    case missingConfiguration
    case invalidConfiguration
}
