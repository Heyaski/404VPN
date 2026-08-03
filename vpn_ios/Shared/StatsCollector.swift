import Foundation

/// Периодически снимает счётчики туннеля и складывает их в хранилище.
///
/// Источник счётчиков передаётся замыканием, а не берётся из `WireGuardAdapter`
/// напрямую: благодаря этому коллектор тестируется без туннеля и без NetworkExtension.
final class StatsCollector {
    private let store: StatsStore
    private let fetch: () async -> String?
    private let interval: Duration
    private var sessionId: UUID?
    private var loop: Task<Void, Never>?

    init(store: StatsStore, interval: Duration = .seconds(5), fetch: @escaping () async -> String?) {
        self.store = store
        self.interval = interval
        self.fetch = fetch
    }

    /// Открывает сессию и запускает периодический съём.
    func start(now: Date = Date()) {
        sessionId = store.openSession(at: now)
        loop = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: self.interval)
                if Task.isCancelled { return }
                await self.tick()
            }
        }
    }

    /// Один цикл: снять счётчики, записать снимок, обновить открытую сессию.
    func tick(now: Date = Date()) async {
        // нет ответа от адаптера — оставляем последние известные значения,
        // иначе виджет мигнёт нулями на ровном месте
        guard let raw = await fetch() else { return }
        let stats = RuntimeConfigParser.parse(raw, capturedAt: now)
        store.writeSnapshot(stats)
        if let sessionId {
            store.updateSession(id: sessionId, rxBytes: stats.rxBytes, txBytes: stats.txBytes, now: now)
        }
    }

    /// Останавливает съём, дописывает последние счётчики и закрывает сессию.
    func stop(now: Date = Date()) async {
        loop?.cancel()
        loop = nil
        await tick(now: now)

        if let sessionId {
            let snapshot = store.readSnapshot()
            store.updateSession(id: sessionId, rxBytes: snapshot.rxBytes, txBytes: snapshot.txBytes,
                                endedAt: now, now: now)
        }
        sessionId = nil

        var closing = store.readSnapshot()
        closing.isConnected = false
        closing.capturedAt = now
        store.writeSnapshot(closing)
    }

    /// Текущие счётчики для ответа приложению по IPC.
    func currentStats(now: Date = Date()) async -> TunnelStats {
        guard let raw = await fetch() else { return store.readSnapshot() }
        return RuntimeConfigParser.parse(raw, capturedAt: now)
    }
}
