import Foundation

/// Единственный, кто знает, как статистика лежит на диске. Расширение пишет,
/// приложение и виджет читают — через общий контейнер App Group.
///
/// Формат намеренно спрятан за этим типом: три процесса ходят только сюда,
/// поэтому хранение можно поменять, не трогая их.
final class StatsStore {
    /// Сессии старше этого срока отбрасываются при следующей записи.
    /// 90 дней — с запасом к самому длинному периоду в интерфейсе (месяц).
    static let retention: TimeInterval = 90 * 24 * 60 * 60

    private let snapshotURL: URL
    private let sessionsURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(directory: URL) {
        snapshotURL = directory.appendingPathComponent("stats-snapshot.json")
        sessionsURL = directory.appendingPathComponent("sessions.json")
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    /// Боевой экземпляр. nil, если App Group недоступна — вызывающий работает без статистики.
    static var shared: StatsStore? {
        AppGroup.containerURL.map(StatsStore.init(directory:))
    }

    // MARK: - Снимок

    func writeSnapshot(_ stats: TunnelStats) {
        guard let data = try? encoder.encode(stats) else { return }
        try? data.write(to: snapshotURL, options: .atomic)
    }

    func readSnapshot() -> TunnelStats {
        guard let data = try? Data(contentsOf: snapshotURL),
              let stats = try? decoder.decode(TunnelStats.self, from: data)
        else { return .empty }
        return stats
    }

    // MARK: - Сессии

    func readSessions() -> [SessionRecord] {
        guard let data = try? Data(contentsOf: sessionsURL),
              let list = try? decoder.decode([SessionRecord].self, from: data)
        else { return [] }
        return list
    }

    /// Открывает новую сессию. Незакрытые предыдущие закрываются: расширение
    /// могли убить, не дав ему записать конец.
    @discardableResult
    func openSession(at date: Date = Date()) -> UUID {
        var sessions = readSessions()
        for index in sessions.indices where sessions[index].endedAt == nil {
            sessions[index].endedAt = sessions[index].startedAt
        }
        let record = SessionRecord(id: UUID(), startedAt: date, endedAt: nil, rxBytes: 0, txBytes: 0)
        sessions.append(record)
        write(sessions, now: date)
        return record.id
    }

    func updateSession(id: UUID, rxBytes: UInt64, txBytes: UInt64,
                       endedAt: Date? = nil, now: Date = Date()) {
        var sessions = readSessions()
        guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions[index].rxBytes = rxBytes
        sessions[index].txBytes = txBytes
        if let endedAt { sessions[index].endedAt = endedAt }
        write(sessions, now: now)
    }

    private func write(_ sessions: [SessionRecord], now: Date) {
        let cutoff = now.addingTimeInterval(-Self.retention)
        let kept = sessions.filter { $0.startedAt >= cutoff }
        guard let data = try? encoder.encode(kept) else { return }
        try? data.write(to: sessionsURL, options: .atomic)
    }
}
