import XCTest
@testable import VPN404

final class RouteCalculatorTests: XCTestCase {
    func testEmptyExclusionsGiveWholeInternet() {
        XCTAssertEqual(RouteCalculator.allowedIPs(excluding: []), ["0.0.0.0/0", "::/0"])
    }

    func testGarbageIsIgnored() {
        XCTAssertEqual(RouteCalculator.allowedIPs(excluding: ["не адрес", "10.0.0.0/99"]),
                       ["0.0.0.0/0", "::/0"],
                       "мусор не должен превращаться в отсутствие маршрутов")
    }

    func testExcludingHalfGivesOtherHalf() {
        let result = RouteCalculator.allowedIPs(excluding: ["0.0.0.0/1"])

        XCTAssertEqual(result.filter { !$0.contains(":") }, ["128.0.0.0/1"])
    }

    func testExcludedRangeIsNotCovered() {
        let result = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8"])
        let ipv4 = result.filter { !$0.contains(":") }

        XCTAssertFalse(ipv4.contains("10.0.0.0/8"))
        XCTAssertFalse(ipv4.contains("0.0.0.0/0"))
        XCTAssertTrue(ipv4.contains("11.0.0.0/8"), "соседний диапазон должен остаться в туннеле")
        XCTAssertTrue(ipv4.contains("192.0.0.0/2") || ipv4.contains("128.0.0.0/1"))
    }

    /// Исключить всё адресное пространство — это не «оставить человека без IPv4»,
    /// а признак испорченных данных: возвращаемся к полному туннелю.
    func testExcludingEverythingFallsBackToWholeFamily() {
        let result = RouteCalculator.allowedIPs(excluding: ["0.0.0.0/0"])

        XCTAssertEqual(result, ["0.0.0.0/0", "::/0"])
    }

    func testExcludingAllIPv6FallsBackButKeepsIPv4Split() {
        let result = RouteCalculator.allowedIPs(excluding: ["::/0", "10.0.0.0/8"])

        XCTAssertTrue(result.contains("::/0"), "IPv6 возвращается целиком")
        XCTAssertFalse(result.contains("0.0.0.0/0"), "а разбиение IPv4 сохраняется")
        XCTAssertTrue(result.contains("11.0.0.0/8"))
    }

    func testIPv6ExclusionAffectsOnlyIPv6() {
        let result = RouteCalculator.allowedIPs(excluding: ["2000::/3"])

        XCTAssertTrue(result.contains("0.0.0.0/0"), "IPv4 остаётся целым")
        XCTAssertFalse(result.contains("::/0"))
        // ::/1 тоже нельзя отдать целиком — исключённый 2000::/3 лежит внутри него
        XCTAssertFalse(result.contains("::/1"))
        XCTAssertTrue(result.contains("::/3"))
        XCTAssertTrue(result.contains("4000::/2"))
        XCTAssertTrue(result.contains("8000::/1"))
    }

    func testNestedExclusionsCollapse() {
        let broad = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8"])
        let withNested = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8", "10.1.0.0/16"])

        XCTAssertEqual(broad, withNested, "вложенный диапазон ничего не добавляет")
    }

    func testParseAndFormatRoundTrip() {
        XCTAssertEqual(RouteCalculator.format(RouteCalculator.parse("192.168.0.0/16")!),
                       "192.168.0.0/16")
        XCTAssertEqual(RouteCalculator.format(RouteCalculator.parse("2a02:6b8::/32")!),
                       "2a02:6b8::/32")
    }

    func testParseMasksHostBits() {
        XCTAssertEqual(RouteCalculator.parse("10.1.2.3/8"), RouteCalculator.parse("10.0.0.0/8"))
    }

    /// Результат должен покрывать ровно то, что не исключено: проверяем выборочные адреса.
    func testCoverageIsExact() {
        let result = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8"])
            .filter { !$0.contains(":") }
            .compactMap(RouteCalculator.parse)

        func covered(_ address: String) -> Bool {
            guard let probe = RouteCalculator.parse("\(address)/32") else { return false }
            return result.contains { RouteCalculator.covers($0, probe) }
        }

        XCTAssertFalse(covered("10.5.5.5"), "исключённый адрес не должен идти в туннель")
        XCTAssertTrue(covered("9.255.255.255"))
        XCTAssertTrue(covered("11.0.0.0"))
        XCTAssertTrue(covered("8.8.8.8"))
    }
}
