import XCTest
@testable import VPN404

/// Самый опасный краевой случай всей переделки: правила автоподключения при
/// выключенном на сервере пире оставляют человека вообще без интернета.
final class SuspendedAccountTests: XCTestCase {
    private let config = TunnelConfig(
        privateKey: "aaa", address: "10.8.0.5/24", dns: ["1.1.1.1"],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))

    func testOnDemandStaysOffForEveryModeWhileSuspended() {
        for mode in AutoConnectMode.allCases {
            let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                         autoConnect: mode, accountSuspended: true)
            XCTAssertFalse(settings.onDemandEnabled,
                           "режим \(mode) не должен включать правила при suspended")
        }
    }

    func testOnDemandComesBackAfterTopUp() {
        let suspended = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                      autoConnect: .always, accountSuspended: true)
        let restored = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .always, accountSuspended: false)

        XCTAssertFalse(suspended.onDemandEnabled)
        XCTAssertTrue(restored.onDemandEnabled, "после пополнения правила возвращаются сами")
    }

    func testKillSwitchIsIndependentOfSuspension() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: true,
                                                     autoConnect: .off, accountSuspended: true)

        XCTAssertTrue(settings.includeAllNetworks)
    }
}
