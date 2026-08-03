import XCTest
@testable import VPN404

final class RuntimeConfigParserTests: XCTestCase {
    private let captured = Date(timeIntervalSince1970: 1_700_000_100)

    /// Ровно тот формат, который отдаёт wg по UAPI.
    private let sample = """
    private_key=e8f1a0
    listen_port=51820
    public_key=b3c2d1
    preshared_key=0000
    protocol_version=1
    endpoint=195.14.118.198:51820
    last_handshake_time_sec=1700000000
    last_handshake_time_nsec=482000000
    tx_bytes=2048
    rx_bytes=8192
    persistent_keepalive_interval=25
    errno=0
    """

    func testParsesCounters() {
        let stats = RuntimeConfigParser.parse(sample, capturedAt: captured)

        XCTAssertEqual(stats.rxBytes, 8192)
        XCTAssertEqual(stats.txBytes, 2048)
        XCTAssertEqual(stats.capturedAt, captured)
    }

    func testParsesHandshakeAndMarksConnected() {
        let stats = RuntimeConfigParser.parse(sample, capturedAt: captured)

        XCTAssertEqual(stats.lastHandshake, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertTrue(stats.isConnected)
    }

    func testNoHandshakeMeansNotConnected() {
        let raw = "public_key=b3c2d1\nlast_handshake_time_sec=0\nrx_bytes=0\ntx_bytes=0"

        let stats = RuntimeConfigParser.parse(raw, capturedAt: captured)

        XCTAssertNil(stats.lastHandshake)
        XCTAssertFalse(stats.isConnected)
    }

    func testSumsCountersAcrossPeers() {
        let raw = """
        public_key=aaa
        rx_bytes=100
        tx_bytes=10
        public_key=bbb
        rx_bytes=250
        tx_bytes=25
        """

        let stats = RuntimeConfigParser.parse(raw, capturedAt: captured)

        XCTAssertEqual(stats.rxBytes, 350)
        XCTAssertEqual(stats.txBytes, 35)
    }

    func testGarbageInputYieldsZeroes() {
        let stats = RuntimeConfigParser.parse("не пойми что\n\nrx_bytes=\n=42", capturedAt: captured)

        XCTAssertEqual(stats.rxBytes, 0)
        XCTAssertEqual(stats.txBytes, 0)
        XCTAssertFalse(stats.isConnected)
    }

    func testEmptyInputYieldsEmptyStatsWithTimestamp() {
        let stats = RuntimeConfigParser.parse("", capturedAt: captured)

        XCTAssertEqual(stats.rxBytes, 0)
        XCTAssertEqual(stats.capturedAt, captured)
    }
}
