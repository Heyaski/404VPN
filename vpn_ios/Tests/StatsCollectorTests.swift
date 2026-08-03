import XCTest
@testable import VPN404

final class StatsCollectorTests: XCTestCase {
    private var directory: URL!
    private var store: StatsStore!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        store = StatsStore(directory: directory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func uapi(rx: UInt64, tx: UInt64, handshake: Int) -> String {
        "rx_bytes=\(rx)\ntx_bytes=\(tx)\nlast_handshake_time_sec=\(handshake)"
    }

    func testTickWritesSnapshot() async {
        let collector = StatsCollector(store: store) { self.uapi(rx: 500, tx: 100, handshake: 1_700_000_000) }
        let now = Date(timeIntervalSince1970: 1_700_000_010)

        await collector.tick(now: now)

        let snapshot = store.readSnapshot()
        XCTAssertEqual(snapshot.rxBytes, 500)
        XCTAssertEqual(snapshot.txBytes, 100)
        XCTAssertEqual(snapshot.capturedAt, now)
        XCTAssertTrue(snapshot.isConnected)
    }

    func testTickUpdatesOpenSession() async {
        let collector = StatsCollector(store: store) { self.uapi(rx: 700, tx: 300, handshake: 1_700_000_000) }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        collector.start(now: start)

        await collector.tick(now: start.addingTimeInterval(5))

        let session = store.readSessions().first
        XCTAssertEqual(session?.rxBytes, 700)
        XCTAssertEqual(session?.txBytes, 300)
        XCTAssertNil(session?.endedAt, "пока не остановлен, сессия открыта")
    }

    func testStopClosesSessionAndMarksDisconnected() async {
        let collector = StatsCollector(store: store) { self.uapi(rx: 900, tx: 100, handshake: 1_700_000_000) }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let end = start.addingTimeInterval(600)
        collector.start(now: start)

        await collector.stop(now: end)

        let session = store.readSessions().first
        XCTAssertEqual(session?.endedAt, end)
        XCTAssertEqual(session?.totalBytes, 1000)
        XCTAssertFalse(store.readSnapshot().isConnected,
                       "после остановки снимок не должен утверждать, что туннель жив")
    }

    func testMissingRuntimeConfigLeavesSnapshotUntouched() async {
        store.writeSnapshot(TunnelStats(rxBytes: 42, txBytes: 42, lastHandshake: nil,
                                        capturedAt: Date(timeIntervalSince1970: 1), isConnected: true))
        let collector = StatsCollector(store: store) { nil }

        await collector.tick(now: Date(timeIntervalSince1970: 1_700_000_000))

        XCTAssertEqual(store.readSnapshot().rxBytes, 42, "нет данных — не затираем последние известные")
    }

    func testCurrentStatsFallsBackToSnapshot() async {
        store.writeSnapshot(TunnelStats(rxBytes: 7, txBytes: 3, lastHandshake: nil,
                                        capturedAt: Date(timeIntervalSince1970: 1), isConnected: false))
        let collector = StatsCollector(store: store) { nil }

        let stats = await collector.currentStats(now: Date(timeIntervalSince1970: 1_700_000_000))

        XCTAssertEqual(stats.rxBytes, 7)
    }
}
