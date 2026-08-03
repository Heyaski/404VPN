import XCTest
@testable import VPN404

final class StatsStoreTests: XCTestCase {
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

    func testSnapshotRoundTrip() {
        let handshake = Date(timeIntervalSince1970: 1_700_000_000)
        let captured = Date(timeIntervalSince1970: 1_700_000_005)
        let stats = TunnelStats(rxBytes: 4096, txBytes: 2048, lastHandshake: handshake,
                                capturedAt: captured, isConnected: true)

        store.writeSnapshot(stats)

        XCTAssertEqual(store.readSnapshot(), stats)
    }

    func testSnapshotIsEmptyBeforeFirstWrite() {
        XCTAssertEqual(store.readSnapshot(), TunnelStats.empty)
    }

    func testOpenSessionAppendsOpenRecord() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)

        let id = store.openSession(at: start)

        let sessions = store.readSessions()
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.id, id)
        XCTAssertEqual(sessions.first?.startedAt, start)
        XCTAssertNil(sessions.first?.endedAt)
    }

    func testOpeningSessionClosesPreviousDanglingOne() {
        let first = Date(timeIntervalSince1970: 1_700_000_000)
        let second = first.addingTimeInterval(3600)
        store.openSession(at: first)

        store.openSession(at: second)

        let sessions = store.readSessions()
        XCTAssertEqual(sessions.count, 2)
        XCTAssertEqual(sessions[0].endedAt, first, "оборванная сессия закрывается своим же началом")
        XCTAssertNil(sessions[1].endedAt)
    }

    func testUpdateSessionStoresCountersAndEnd() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let end = start.addingTimeInterval(600)
        let id = store.openSession(at: start)

        store.updateSession(id: id, rxBytes: 900, txBytes: 100, endedAt: end, now: end)

        let session = store.readSessions().first
        XCTAssertEqual(session?.rxBytes, 900)
        XCTAssertEqual(session?.txBytes, 100)
        XCTAssertEqual(session?.endedAt, end)
        XCTAssertEqual(session?.totalBytes, 1000)
    }

    func testSessionsOlderThanRetentionAreDropped() {
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        let now = old.addingTimeInterval(StatsStore.retention + 86_400)
        store.openSession(at: old)

        store.openSession(at: now)

        let sessions = store.readSessions()
        XCTAssertEqual(sessions.count, 1, "старше 90 дней не хранится")
        XCTAssertEqual(sessions.first?.startedAt, now)
    }
}
