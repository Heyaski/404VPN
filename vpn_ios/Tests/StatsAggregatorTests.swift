import XCTest
@testable import VPN404

final class StatsAggregatorTests: XCTestCase {
    /// Фиксированный календарь: иначе тест поедет вместе с часовым поясом машины.
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    private func session(day: Int, rx: UInt64, tx: UInt64) -> SessionRecord {
        let start = Date(timeIntervalSince1970: TimeInterval(day) * 86_400 + 3600)
        return SessionRecord(id: UUID(), startedAt: start, endedAt: start.addingTimeInterval(600),
                             rxBytes: rx, txBytes: tx)
    }

    func testEmptyInputGivesEmptyResult() {
        XCTAssertTrue(StatsAggregator.byDay([], calendar: calendar).isEmpty)
    }

    func testSessionsOnSameDayAreSummed() {
        let result = StatsAggregator.byDay([session(day: 10, rx: 100, tx: 10),
                                            session(day: 10, rx: 200, tx: 20)],
                                           calendar: calendar)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].rxBytes, 300)
        XCTAssertEqual(result[0].txBytes, 30)
        XCTAssertEqual(result[0].totalBytes, 330)
    }

    func testResultIsSortedByDayAscending() {
        let result = StatsAggregator.byDay([session(day: 12, rx: 1, tx: 1),
                                            session(day: 10, rx: 1, tx: 1),
                                            session(day: 11, rx: 1, tx: 1)],
                                           calendar: calendar)

        XCTAssertEqual(result.count, 3)
        XCTAssertTrue(result[0].day < result[1].day)
        XCTAssertTrue(result[1].day < result[2].day)
    }

    func testFiltersSessionsToPeriod() {
        let now = Date(timeIntervalSince1970: 20 * 86_400)
        let all = [session(day: 19, rx: 1, tx: 1), session(day: 5, rx: 1, tx: 1)]

        let week = StatsAggregator.sessions(all, in: .week, now: now, calendar: calendar)

        XCTAssertEqual(week.count, 1, "сессия двухнедельной давности в неделю не попадает")
    }

    func testDayPeriodKeepsOnlyToday() {
        let now = Date(timeIntervalSince1970: 20 * 86_400 + 7200)
        let all = [session(day: 20, rx: 1, tx: 1), session(day: 19, rx: 1, tx: 1)]

        let today = StatsAggregator.sessions(all, in: .day, now: now, calendar: calendar)

        XCTAssertEqual(today.count, 1)
    }

    func testEveryPeriodHasTitleAndPositiveLength() {
        for period in StatsPeriod.allCases {
            XCTAssertFalse(period.title.isEmpty)
            XCTAssertGreaterThan(period.days, 0)
        }
    }
}
