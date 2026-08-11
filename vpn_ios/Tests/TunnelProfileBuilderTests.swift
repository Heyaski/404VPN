import XCTest
@testable import VPN404

final class TunnelProfileBuilderTests: XCTestCase {
    private let config = TunnelConfig(
        privateKey: "aaa",
        address: "10.8.0.5/24",
        dns: ["1.1.1.1"],
        dnsFiltered: ["10.8.0.53"],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))

    func testServerAddressIsAppNameNotIP() {
        let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .off, accountSuspended: false,
                                               dnsFilter: false)

        XCTAssertEqual(settings.serverAddress, "Overlay")
        XCTAssertFalse(settings.serverAddress.contains("195.14"),
                       "IP сервера пользователю показывать незачем")
    }

    func testAllNetworksFlagIsAlwaysOff() {
        let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .always,
                                                     accountSuspended: false,
                                                     dnsFilter: false)

        XCTAssertFalse(settings.includeAllNetworks,
                       "флаг живёт в сохранённом профиле: его надо явно гасить, а не просто не выставлять")
    }

    func testOnDemandEnabledWhenModeSet() {
        let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .always, accountSuspended: false,
                                                     dnsFilter: false)

        XCTAssertTrue(settings.onDemandEnabled)
    }

    func testSuspendedAccountDisablesOnDemand() {
        let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .always, accountSuspended: true,
                                                     dnsFilter: false)

        XCTAssertFalse(settings.onDemandEnabled,
                       "при нулевом балансе пир выключен на сервере: правила оставили бы человека без интернета")
    }

    func testConfigTextIsCarriedThrough() {
        let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .off, accountSuspended: false,
                                               dnsFilter: false)

        XCTAssertEqual(settings.wgQuickConfig, config.wgQuick(filtered: false))
    }

    func testDnsFilterSelectsFilteringResolvers() {
        let on = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .off, accountSuspended: false,
                                               dnsFilter: true)

        XCTAssertTrue(on.wgQuickConfig.contains("DNS = 10.8.0.53"))
    }

    func testDnsFilterOffKeepsPlainResolvers() {
        let off = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .off, accountSuspended: false,
                                                dnsFilter: false)

        XCTAssertTrue(off.wgQuickConfig.contains("DNS = 1.1.1.1"))
    }
}
