import XCTest
@testable import VPN404

/// Самый опасный краевой случай всей переделки: правила автоподключения при
/// выключенном на сервере пире оставляют человека вообще без интернета.
final class SuspendedAccountTests: XCTestCase {
    private let config = TunnelConfig(
        privateKey: "aaa", address: "10.8.0.5/24", dns: ["1.1.1.1"], dnsFiltered: [], bypassRoutes: [],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))

    func testOnDemandStaysOffForEveryModeWhileSuspended() {
        for mode in AutoConnectMode.allCases {
            let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: mode, accountSuspended: true,
                                                         dnsFilter: false)
            XCTAssertFalse(settings.onDemandEnabled,
                           "режим \(mode) не должен включать правила при suspended")
        }
    }

    func testOnDemandComesBackAfterTopUp() {
        let suspended = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .always, accountSuspended: true,
                                                      dnsFilter: false)
        let restored = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .always, accountSuspended: false,
                                                     dnsFilter: false)

        XCTAssertFalse(suspended.onDemandEnabled)
        XCTAssertTrue(restored.onDemandEnabled, "после пополнения правила возвращаются сами")
    }

}
