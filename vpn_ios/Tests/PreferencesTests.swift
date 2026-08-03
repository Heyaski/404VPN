import XCTest
@testable import VPN404

final class PreferencesTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!
    private var preferences: Preferences!

    override func setUp() {
        super.setUp()
        suiteName = "test.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        preferences = Preferences(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testAutoConnectDefaultsToOff() {
        XCTAssertEqual(preferences.autoConnectMode, .off)
    }

    func testAutoConnectRoundTrip() {
        preferences.autoConnectMode = .wifiOnly

        XCTAssertEqual(Preferences(defaults: defaults).autoConnectMode, .wifiOnly)
    }

    func testUnknownStoredModeFallsBackToOff() {
        defaults.set("чепуха", forKey: "autoConnectMode")

        XCTAssertEqual(preferences.autoConnectMode, .off)
    }

    func testTrustedNetworksRoundTrip() {
        preferences.trustedNetworks = ["Дом", "Офис"]

        XCTAssertEqual(Preferences(defaults: defaults).trustedNetworks, ["Дом", "Офис"])
    }

    func testKillSwitchIsOffByDefault() {
        XCTAssertFalse(preferences.killSwitch,
                       "includeAllNetworks ломает локальную сеть — по умолчанию выключен")
    }

    func testLastBalanceRoundTrip() {
        preferences.lastBalance = "412.50"

        XCTAssertEqual(Preferences(defaults: defaults).lastBalance, "412.50")
    }

    func testEveryModeHasTitle() {
        for mode in AutoConnectMode.allCases {
            XCTAssertFalse(mode.title.isEmpty, "\(mode) без названия")
        }
    }
}
