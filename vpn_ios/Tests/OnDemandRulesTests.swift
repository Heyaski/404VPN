import NetworkExtension
import XCTest
@testable import VPN404

final class OnDemandRulesTests: XCTestCase {
    func testOffProducesNoRules() {
        XCTAssertTrue(OnDemandRules.rules(mode: .off, trustedNetworks: []).isEmpty)
    }

    func testAlwaysConnectsOnAnyInterface() {
        let rules = OnDemandRules.rules(mode: .always, trustedNetworks: [])

        XCTAssertEqual(rules.count, 1)
        XCTAssertEqual(rules[0].action, .connect)
        XCTAssertEqual(rules[0].interfaceTypeMatch, .any)
    }

    func testCellularOnlyConnectsOnCellularAndDisconnectsOnWiFi() {
        let rules = OnDemandRules.rules(mode: .cellularOnly, trustedNetworks: [])

        XCTAssertEqual(rules.map(\.action), [.connect, .disconnect])
        XCTAssertEqual(rules[0].interfaceTypeMatch, .cellular)
        XCTAssertEqual(rules[1].interfaceTypeMatch, .wiFi)
    }

    func testWifiOnlyConnectsOnWiFiAndDisconnectsOnCellular() {
        let rules = OnDemandRules.rules(mode: .wifiOnly, trustedNetworks: [])

        XCTAssertEqual(rules.map(\.action), [.connect, .disconnect])
        XCTAssertEqual(rules[0].interfaceTypeMatch, .wiFi)
        XCTAssertEqual(rules[1].interfaceTypeMatch, .cellular)
    }

    func testTrustedNetworksRuleComesFirst() {
        let rules = OnDemandRules.rules(mode: .always, trustedNetworks: ["Дом"])

        XCTAssertEqual(rules.first?.action, .disconnect,
                       "правила разбираются по порядку: доверенная сеть должна отсекаться раньше подключения")
        XCTAssertEqual(rules.first?.interfaceTypeMatch, .wiFi)
        XCTAssertEqual(rules.first?.ssidMatch, ["Дом"])
    }

    func testTrustedNetworksIgnoredWhenModeIsOff() {
        XCTAssertTrue(OnDemandRules.rules(mode: .off, trustedNetworks: ["Дом"]).isEmpty)
    }
}
