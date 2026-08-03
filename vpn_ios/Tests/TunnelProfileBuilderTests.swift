import XCTest
@testable import VPN404

final class TunnelProfileBuilderTests: XCTestCase {
    private let config = TunnelConfig(
        privateKey: "aaa",
        address: "10.8.0.5/24",
        dns: ["1.1.1.1"],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))

    func testServerAddressIsAppNameNotIP() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .off, accountSuspended: false)

        XCTAssertEqual(settings.serverAddress, "Overlay")
        XCTAssertFalse(settings.serverAddress.contains("195.14"),
                       "IP сервера пользователю показывать незачем")
    }

    func testKillSwitchMapsToIncludeAllNetworks() {
        let on = TunnelProfileBuilder.settings(config: config, killSwitch: true,
                                               autoConnect: .off, accountSuspended: false)
        let off = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                autoConnect: .off, accountSuspended: false)

        XCTAssertTrue(on.includeAllNetworks)
        XCTAssertFalse(off.includeAllNetworks)
    }

    func testOnDemandEnabledWhenModeSet() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .always, accountSuspended: false)

        XCTAssertTrue(settings.onDemandEnabled)
    }

    func testSuspendedAccountDisablesOnDemand() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .always, accountSuspended: true)

        XCTAssertFalse(settings.onDemandEnabled,
                       "при нулевом балансе пир выключен на сервере: правила оставили бы человека без интернета")
    }

    func testConfigTextIsCarriedThrough() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .off, accountSuspended: false)

        XCTAssertEqual(settings.wgQuickConfig, config.wgQuickConfig)
    }
}
