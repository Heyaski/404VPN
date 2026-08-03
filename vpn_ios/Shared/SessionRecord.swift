import Foundation

/// Одно подключение: от старта туннеля до остановки.
struct SessionRecord: Codable, Equatable, Identifiable {
    var id: UUID
    var startedAt: Date
    var endedAt: Date?
    var rxBytes: UInt64
    var txBytes: UInt64

    /// У незакрытой сессии длительность считается до текущего момента.
    func duration(now: Date = Date()) -> TimeInterval {
        (endedAt ?? now).timeIntervalSince(startedAt)
    }

    var totalBytes: UInt64 { rxBytes + txBytes }
}
