import XCTest
@testable import VPN404

final class CodeFormatterTests: XCTestCase {
    func testGroupsIntoFours() {
        XCTAssertEqual(CodeFormatter.format("fq395hywh814r3ej"), "FQ39-5HYW-H814-R3EJ")
    }

    func testDropsSeparatorsAndKeepsGrouping() {
        XCTAssertEqual(CodeFormatter.format("fq39 5hyw-h814"), "FQ39-5HYW-H814")
    }

    func testTruncatesBeyondSixteenCharacters() {
        XCTAssertEqual(CodeFormatter.format("FQ395HYWH814R3EJEXTRA"), "FQ39-5HYW-H814-R3EJ")
    }

    func testPartialInputHasNoTrailingDash() {
        XCTAssertEqual(CodeFormatter.format("FQ39"), "FQ39")
        XCTAssertEqual(CodeFormatter.format("FQ395"), "FQ39-5")
    }

    func testIsComplete() {
        XCTAssertTrue(CodeFormatter.isComplete("FQ39-5HYW-H814-R3EJ"))
        XCTAssertFalse(CodeFormatter.isComplete("FQ39-5HYW-H814"))
    }
}

final class TunnelConfigTests: XCTestCase {
    private let json = """
    {
      "privateKey": "aPrivate=",
      "address": "192.168.101.3/24",
      "dns": ["8.8.8.8", "8.8.4.4"],
      "peer": {
        "publicKey": "aPublic=",
        "presharedKey": "aShared=",
        "endpoint": "195.14.118.198:51820",
        "allowedIps": ["0.0.0.0/0", "::/0"],
        "persistentKeepalive": 15
      }
    }
    """.data(using: .utf8)!

    func testDecodesBackendResponse() throws {
        let config = try JSONDecoder().decode(TunnelConfig.self, from: json)
        XCTAssertEqual(config.address, "192.168.101.3/24")
        XCTAssertEqual(config.peer.endpoint, "195.14.118.198:51820")
        XCTAssertEqual(config.peer.persistentKeepalive, 15)
    }

    func testBuildsWgQuickConfig() throws {
        let config = try JSONDecoder().decode(TunnelConfig.self, from: json)
        XCTAssertEqual(config.wgQuick(filtered: false), """
        [Interface]
        PrivateKey = aPrivate=
        Address = 192.168.101.3/24
        DNS = 8.8.8.8, 8.8.4.4

        [Peer]
        PublicKey = aPublic=
        PresharedKey = aShared=
        AllowedIPs = 0.0.0.0/0, ::/0
        Endpoint = 195.14.118.198:51820
        PersistentKeepalive = 15
        """)
    }

    func testOmitsOptionalFieldsWhenAbsent() throws {
        let minimal = """
        {"privateKey":"k","address":"10.0.0.2/32","dns":[],
         "peer":{"publicKey":"p","presharedKey":null,"endpoint":"h:51820",
                 "allowedIps":["0.0.0.0/0"],"persistentKeepalive":null}}
        """.data(using: .utf8)!
        let config = try JSONDecoder().decode(TunnelConfig.self, from: minimal)
        XCTAssertFalse(config.wgQuick(filtered: false).contains("DNS"))
        XCTAssertFalse(config.wgQuick(filtered: false).contains("PresharedKey"))
        XCTAssertFalse(config.wgQuick(filtered: false).contains("PersistentKeepalive"))
    }
}

final class ApiErrorTests: XCTestCase {
    func testMapsBackendCodes() {
        XCTAssertEqual(ApiError.from(code: "already_used", status: 400), .alreadyUsed)
        XCTAssertEqual(ApiError.from(code: "suspended", status: 402), .suspended)
        XCTAssertEqual(ApiError.from(code: "wg_unavailable", status: 503), .tunnelUnavailable)
    }

    func testUnknownCodeFallsBackToNetworkError() {
        guard case .network = ApiError.from(code: "нечто", status: 500) else {
            return XCTFail("ожидался .network")
        }
    }

    func testEveryErrorHasRussianDescription() {
        let all: [ApiError] = [.invalidCode, .alreadyUsed, .expired, .revoked, .tooManyAttempts,
                               .suspended, .blocked, .unauthorized, .tunnelUnavailable]
        for error in all {
            XCTAssertFalse(error.errorDescription?.isEmpty ?? true, "нет текста для \(error)")
        }
    }
}

final class TunnelConfigDnsTests: XCTestCase {
    private func config(dns: [String], filtered: [String]) -> TunnelConfig {
        TunnelConfig(privateKey: "priv", address: "10.8.0.5/24", dns: dns, dnsFiltered: filtered,
                     peer: TunnelPeer(publicKey: "pub", presharedKey: nil,
                                      endpoint: "1.2.3.4:51820",
                                      allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))
    }

    func testPlainConfigUsesDefaultResolvers() {
        let text = config(dns: ["1.1.1.1"], filtered: ["10.8.0.53"]).wgQuick(filtered: false)

        XCTAssertTrue(text.contains("DNS = 1.1.1.1"))
        XCTAssertFalse(text.contains("10.8.0.53"))
    }

    func testFilteredConfigUsesFilteringResolvers() {
        let text = config(dns: ["1.1.1.1"], filtered: ["10.8.0.53"]).wgQuick(filtered: true)

        XCTAssertTrue(text.contains("DNS = 10.8.0.53"))
        XCTAssertFalse(text.contains("1.1.1.1"))
    }

    func testFilterUnavailableFallsBackToDefault() {
        let text = config(dns: ["1.1.1.1"], filtered: []).wgQuick(filtered: true)

        XCTAssertTrue(text.contains("DNS = 1.1.1.1"),
                      "фильтр не настроен на сервере — подключение всё равно должно состояться")
    }

    func testFilterAvailability() {
        XCTAssertTrue(config(dns: ["1.1.1.1"], filtered: ["10.8.0.53"]).isFilterAvailable)
        XCTAssertFalse(config(dns: ["1.1.1.1"], filtered: []).isFilterAvailable)
    }

    func testDecodesResponseWithoutDnsFiltered() throws {
        let json = """
        {"privateKey":"p","address":"10.8.0.5/24","dns":["1.1.1.1"],
         "peer":{"publicKey":"pub","presharedKey":null,"endpoint":"1.2.3.4:51820",
                 "allowedIps":["0.0.0.0/0"],"persistentKeepalive":25}}
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(TunnelConfig.self, from: json)

        XCTAssertEqual(decoded.dnsFiltered, [], "старый сервер без поля не должен ломать разбор")
    }
}
