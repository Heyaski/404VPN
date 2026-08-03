import Foundation

/// Период, за который смотрим статистику.
enum StatsPeriod: String, CaseIterable, Identifiable {
    case day, week, month

    var id: String { rawValue }

    var title: String {
        switch self {
        case .day: return "Сутки"
        case .week: return "Неделя"
        case .month: return "Месяц"
        }
    }

    var days: Int {
        switch self {
        case .day: return 1
        case .week: return 7
        case .month: return 30
        }
    }
}

/// Трафик за один день — столбик графика.
struct DailyTraffic: Equatable, Identifiable {
    var day: Date
    var rxBytes: UInt64
    var txBytes: UInt64

    var id: Date { day }
    var totalBytes: UInt64 { rxBytes + txBytes }
}

/// Пересчёт сессий в то, что рисует экран статистики. Чистые функции: календарь
/// передаётся снаружи, чтобы тест не зависел от часового пояса машины.
enum StatsAggregator {
    static func byDay(_ sessions: [SessionRecord], calendar: Calendar = .current) -> [DailyTraffic] {
        var buckets: [Date: DailyTraffic] = [:]
        for session in sessions {
            let day = calendar.startOfDay(for: session.startedAt)
            var bucket = buckets[day] ?? DailyTraffic(day: day, rxBytes: 0, txBytes: 0)
            bucket.rxBytes += session.rxBytes
            bucket.txBytes += session.txBytes
            buckets[day] = bucket
        }
        return buckets.values.sorted { $0.day < $1.day }
    }

    static func sessions(_ all: [SessionRecord], in period: StatsPeriod,
                         now: Date = Date(), calendar: Calendar = .current) -> [SessionRecord] {
        let today = calendar.startOfDay(for: now)
        guard let from = calendar.date(byAdding: .day, value: -(period.days - 1), to: today) else { return all }
        return all.filter { $0.startedAt >= from }
    }
}
