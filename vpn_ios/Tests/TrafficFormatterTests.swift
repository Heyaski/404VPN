import XCTest
@testable import VPN404

final class TrafficFormatterTests: XCTestCase {
    func testBytesBelowKilobyteStayWhole() {
        XCTAssertEqual(TrafficFormatter.bytes(0), "0 Б")
        XCTAssertEqual(TrafficFormatter.bytes(512), "512 Б")
    }

    func testScalesToLargerUnits() {
        XCTAssertEqual(TrafficFormatter.bytes(1024), "1,0 КБ")
        XCTAssertEqual(TrafficFormatter.bytes(1_572_864), "1,5 МБ")
        XCTAssertEqual(TrafficFormatter.bytes(1_932_735_283), "1,8 ГБ")
    }

    func testUsesCommaAsDecimalSeparator() {
        XCTAssertFalse(TrafficFormatter.bytes(1536).contains("."))
    }

    func testDurationUnderAnHourShowsMinutes() {
        XCTAssertEqual(TrafficFormatter.duration(0), "0 мин")
        XCTAssertEqual(TrafficFormatter.duration(600), "10 мин")
    }

    func testDurationOverAnHourShowsHoursAndMinutes() {
        XCTAssertEqual(TrafficFormatter.duration(3600), "1 ч 0 мин")
        XCTAssertEqual(TrafficFormatter.duration(8100), "2 ч 15 мин")
    }

    func testNegativeDurationIsClampedToZero() {
        XCTAssertEqual(TrafficFormatter.duration(-30), "0 мин")
    }
}
