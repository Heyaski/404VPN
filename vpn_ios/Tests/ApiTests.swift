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
        XCTAssertEqual(config.wgQuickConfig, """
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
        XCTAssertFalse(config.wgQuickConfig.contains("DNS"))
        XCTAssertFalse(config.wgQuickConfig.contains("PresharedKey"))
        XCTAssertFalse(config.wgQuickConfig.contains("PersistentKeepalive"))
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
