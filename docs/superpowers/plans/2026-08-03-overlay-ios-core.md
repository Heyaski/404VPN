# Overlay — ядро iOS-приложения. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить приложение из обёртки над WireGuard (два экрана, 846 строк) в самостоятельный продукт со статистикой трафика, правилами автоподключения и kill switch — чтобы снять отказ Apple по Guideline 4.3(a).

**Architecture:** Расширение туннеля раз в 5 секунд снимает счётчики через `WireGuardAdapter.getRuntimeConfiguration` и пишет снимок в общий контейнер App Group; приложение и (позже) виджеты читают оттуда. Пока открыт экран статистики, приложение дополнительно запрашивает счётчики напрямую через `sendProviderMessage`. Всё, что можно сделать чистой функцией — парсер счётчиков, сборка правил `NEOnDemandRule`, решение о включении автоподключения — вынесено из классов NetworkExtension и покрыто юнит-тестами.

**Tech Stack:** Swift 5, SwiftUI, Swift Charts (iOS 16+), NetworkExtension, WireGuardKit (вендорная копия), XCTest, XcodeGen.

## Global Constraints

- Deployment target — **iOS 16.0**. Ничего, что требует iOS 17+, в этом плане нет.
- Bundle ID **не меняется**: `co.404studio.vpn`, туннель — `co.404studio.vpn.tunnel`.
- Имена таргетов и схем Xcode (`VPN404`, `VPN404Tunnel`, `VPN404Tests`) **не меняются**. Меняется только `CFBundleDisplayName` → `Overlay`.
- App Group — `group.co.404studio.vpn`, уже прописана в entitlements обоих таргетов.
- Проект генерируется XcodeGen: правится `project.yml` и `project.ui.yml`, **не** `.xcodeproj`. После правки надо пересобрать **обе** спеки: `cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml`. Если пересобрать только первую, тесты пойдут по устаревшему `VPN404UI.xcodeproj` и покажут зелёное там, где должно быть красное.
- Каталог, добавленный в `sources`, должен существовать до запуска XcodeGen — иначе генерация падает с «missing source directory».
- Два проекта: `VPN404.xcodeproj` (с туннелем, только устройство) и `VPN404UI.xcodeproj` (без туннеля, симулятор и тесты). Новые файлы в `Shared/` и `App/` надо добавлять **в оба**.
- Сборка проекта с туннелем из командной строки идёт с `CODE_SIGNING_ALLOWED=NO`: она проверяет, что код компилируется. Подпись и установка на устройство делаются из Xcode — `xcodebuild` в этом окружении провижининг-профили не находит.
- Тесты гоняются на симуляторе: `xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test`.
- Тестовый бандл видит только таргет приложения (`@testable import VPN404`). Поэтому всё тестируемое лежит в `Shared/` или `App/`, но не в `Tunnel/`.
- Язык интерфейса и комментариев — русский, как во всём проекте.
- Деньги и трафик показываются с запятой как десятичным разделителем.

## Структура файлов

**Создаётся — `vpn_ios/Shared/`** (компилируется в таргеты приложения и туннеля):

| Файл | Ответственность |
|---|---|
| `AppGroup.swift` | Идентификатор группы, URL контейнера, общие `UserDefaults` |
| `TunnelStats.swift` | Модель снимка счётчиков |
| `SessionRecord.swift` | Модель одной сессии подключения |
| `StatsStore.swift` | Единственный, кто знает формат хранения на диске |
| `StatsAggregator.swift` | Чистая агрегация сессий по дням |
| `RuntimeConfigParser.swift` | Чистый разбор UAPI-строки от WireGuard |
| `StatsCollector.swift` | Периодический съём счётчиков; источник — замыкание, поэтому тестируется |
| `Preferences.swift` | Настройки в общих `UserDefaults` |
| `TrafficFormatter.swift` | Форматирование байтов и длительности |

**Создаётся — `vpn_ios/App/`:**

| Файл | Ответственность |
|---|---|
| `OnDemandRules.swift` | Чистая сборка `[NEOnDemandRule]` по режиму и списку доверенных сетей |
| `TunnelProfileBuilder.swift` | Чистое решение, что записать в профиль |
| `Screens/RootView.swift` | `TabView` с тремя вкладками |
| `Screens/DashboardView.swift` | Дашборд вместо `HomeView` |
| `Screens/StatsView.swift` | График, итоги, история сессий |
| `Screens/SettingsView.swift` | Автоподключение, защита, устройство, о приложении |
| `Components/StatCard.swift` | Карточки приборной панели |
| `Components/TrafficChart.swift` | Столбчатый график на Swift Charts |

**Меняется:**

| Файл | Что |
|---|---|
| `App/VPNManager.swift` | Правила автоподключения, kill switch, запрос счётчиков по IPC |
| `App/AppState.swift` | Худеет до аккаунта и токена; кладёт баланс в `Preferences` |
| `App/App.swift` | Корень — `RootView` |
| `Tunnel/PacketTunnelProvider.swift` | Запуск коллектора, ответ на сообщения приложения |
| `project.yml`, `project.ui.yml` | Папка `Shared`, `CFBundleDisplayName: Overlay` |

**Удаляется:** `App/HomeView.swift` — заменяется на `Screens/DashboardView.swift`. Отвязка устройства переезжает в `SettingsView`.

---

### Task 1: Общий контейнер, модели и хранилище статистики

Фундамент: где лежат данные и в каком виде. Ничего видимого пользователю.

**Files:**
- Create: `vpn_ios/Shared/AppGroup.swift`
- Create: `vpn_ios/Shared/TunnelStats.swift`
- Create: `vpn_ios/Shared/SessionRecord.swift`
- Create: `vpn_ios/Shared/StatsStore.swift`
- Modify: `vpn_ios/project.yml`, `vpn_ios/project.ui.yml`
- Test: `vpn_ios/Tests/StatsStoreTests.swift`

**Interfaces:**
- Produces: `AppGroup.identifier: String`, `AppGroup.containerURL: URL?`, `AppGroup.defaults: UserDefaults?`; `TunnelStats(rxBytes:txBytes:lastHandshake:capturedAt:isConnected:)` и `TunnelStats.empty`; `SessionRecord(id:startedAt:endedAt:rxBytes:txBytes:)` со свойствами `duration: TimeInterval`, `totalBytes: UInt64`; `StatsStore(directory: URL)`, `StatsStore.shared: StatsStore?`, `writeSnapshot(_:)`, `readSnapshot() -> TunnelStats`, `readSessions() -> [SessionRecord]`, `openSession(at:) -> UUID`, `updateSession(id:rxBytes:txBytes:endedAt:now:)`, `StatsStore.retention: TimeInterval`.

- [ ] **Step 1: Подключить папку `Shared` к таргетам**

В `vpn_ios/project.yml` у таргета `VPN404` в `sources` добавить путь, и у таргета `VPN404Tunnel` тоже:

```yaml
  VPN404:
    sources:
      - path: App
      - path: Shared
      - path: Assets.xcassets
```

```yaml
  VPN404Tunnel:
    sources:
      - path: Tunnel
      - path: Shared
```

В `vpn_ios/project.ui.yml` у таргета `VPN404` в `sources` добавить `- path: Shared` тем же образом. В `project.ui.yml` таргета туннеля нет — трогать нечего.

- [ ] **Step 2: Написать падающий тест**

Создать `vpn_ios/Tests/StatsStoreTests.swift`:

```swift
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
```

- [ ] **Step 3: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается провал компиляции: `cannot find 'StatsStore' in scope`.

- [ ] **Step 4: Создать `AppGroup.swift`**

```swift
import Foundation

/// Общий контейнер приложения, расширения туннеля и виджетов.
enum AppGroup {
    static let identifier = "group.co.404studio.vpn"

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: identifier)
    }
}
```

- [ ] **Step 5: Создать `TunnelStats.swift`**

```swift
import Foundation

/// Снимок счётчиков туннеля. Пишет расширение, читают приложение и виджет.
struct TunnelStats: Codable, Equatable {
    var rxBytes: UInt64
    var txBytes: UInt64
    /// Время последнего рукопожатия; nil — рукопожатия ещё не было.
    var lastHandshake: Date?
    /// Когда снимок сделан. Виджет подписывает им данные, чтобы не выдавать старое за свежее.
    var capturedAt: Date
    var isConnected: Bool

    static let empty = TunnelStats(rxBytes: 0, txBytes: 0, lastHandshake: nil,
                                   capturedAt: .distantPast, isConnected: false)
}
```

- [ ] **Step 6: Создать `SessionRecord.swift`**

```swift
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
```

- [ ] **Step 7: Создать `StatsStore.swift`**

```swift
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
```

- [ ] **Step 8: Перегенерировать проект и прогнать тесты**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml
```

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 17 тестов, 0 провалов (11 существующих + 6 новых).

- [ ] **Step 9: Коммит**

```bash
git add vpn_ios/Shared vpn_ios/Tests/StatsStoreTests.swift vpn_ios/project.yml vpn_ios/project.ui.yml
git commit -m "feat(ios): общий контейнер, модели статистики и хранилище"
```

---

### Task 2: Парсер счётчиков туннеля

Чистый разбор UAPI-строки, которую отдаёт `WireGuardAdapter.getRuntimeConfiguration`. Без него снимать статистику не с чего.

**Files:**
- Create: `vpn_ios/Shared/RuntimeConfigParser.swift`
- Test: `vpn_ios/Tests/RuntimeConfigParserTests.swift`

**Interfaces:**
- Consumes: `TunnelStats` из Task 1.
- Produces: `RuntimeConfigParser.parse(_ raw: String, capturedAt: Date) -> TunnelStats`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/RuntimeConfigParserTests.swift`:

```swift
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
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается: `cannot find 'RuntimeConfigParser' in scope`.

- [ ] **Step 3: Создать `vpn_ios/Shared/RuntimeConfigParser.swift`**

```swift
import Foundation

/// Разбирает ответ `WireGuardAdapter.getRuntimeConfiguration` — формат UAPI, тот же,
/// что у `wg show`: строки вида `ключ=значение`, пиры идут подряд.
///
/// Чистая функция: ни сети, ни туннеля, ни файловой системы — поэтому её поведение
/// на битом вводе видно в тесте, а не только в бою.
enum RuntimeConfigParser {
    static func parse(_ raw: String, capturedAt: Date = Date()) -> TunnelStats {
        var rx: UInt64 = 0
        var tx: UInt64 = 0
        var handshakeSeconds: TimeInterval = 0

        for line in raw.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let separator = line.firstIndex(of: "="), separator != line.startIndex else { continue }
            let key = line[line.startIndex..<separator]
            let value = line[line.index(after: separator)...]

            switch key {
            // счётчики суммируются по всем пирам: их может быть больше одного
            case "rx_bytes": rx += UInt64(value) ?? 0
            case "tx_bytes": tx += UInt64(value) ?? 0
            case "last_handshake_time_sec":
                handshakeSeconds = max(handshakeSeconds, TimeInterval(value) ?? 0)
            default: continue
            }
        }

        return TunnelStats(
            rxBytes: rx,
            txBytes: tx,
            lastHandshake: handshakeSeconds > 0 ? Date(timeIntervalSince1970: handshakeSeconds) : nil,
            capturedAt: capturedAt,
            // рукопожатие — единственный честный признак живого туннеля
            isConnected: handshakeSeconds > 0)
    }
}
```

- [ ] **Step 4: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 23 теста, 0 провалов.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/Shared/RuntimeConfigParser.swift vpn_ios/Tests/RuntimeConfigParserTests.swift
git commit -m "feat(ios): разбор счётчиков туннеля из UAPI-строки"
```

---

### Task 3: Коллектор статистики

Связывает парсер и хранилище: периодический съём, открытие и закрытие сессии. Источник счётчиков передаётся замыканием — поэтому коллектор тестируется без туннеля.

**Files:**
- Create: `vpn_ios/Shared/StatsCollector.swift`
- Test: `vpn_ios/Tests/StatsCollectorTests.swift`

**Interfaces:**
- Consumes: `StatsStore`, `TunnelStats` (Task 1), `RuntimeConfigParser.parse` (Task 2).
- Produces: `StatsCollector(store:fetch:)`, `start(now:)`, `tick(now:) async`, `stop(now:) async`, `currentStats(now:) async -> TunnelStats`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/StatsCollectorTests.swift`:

```swift
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
        XCTAssertFalse(store.readSnapshot().isConnected, "после остановки снимок не должен утверждать, что туннель жив")
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
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается: `cannot find 'StatsCollector' in scope`.

- [ ] **Step 3: Создать `vpn_ios/Shared/StatsCollector.swift`**

```swift
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
```

- [ ] **Step 4: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 28 тестов, 0 провалов.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/Shared/StatsCollector.swift vpn_ios/Tests/StatsCollectorTests.swift
git commit -m "feat(ios): коллектор статистики туннеля"
```

---

### Task 4: Расширение туннеля пишет статистику

Подключаем коллектор к настоящему туннелю и учим расширение отвечать приложению по IPC. Собирается только в `VPN404.xcodeproj` (туннель не строится под симулятор), поэтому проверка — сборка под устройство.

**Files:**
- Modify: `vpn_ios/Tunnel/PacketTunnelProvider.swift`

**Interfaces:**
- Consumes: `StatsCollector`, `StatsStore.shared` (Task 1, 3).
- Produces: расширение отвечает на сообщение `"stats"` телом `TunnelStats` в JSON (`.iso8601` для дат) — это контракт для `VPNManager.requestStats()` в Task 7.

- [ ] **Step 1: Создать `vpn_ios/Shared/TunnelMessage.swift`**

Словарь сообщений нужен обоим процессам, поэтому его место в общем коде — иначе строка разъедется между приложением и расширением.

```swift
import Foundation

/// Словарь сообщений между приложением и расширением туннеля.
enum TunnelMessage {
    static let stats = "stats"
}
```

- [ ] **Step 2: Переписать `vpn_ios/Tunnel/PacketTunnelProvider.swift`**

```swift
import NetworkExtension
import WireGuardKit
import os

/// Расширение туннеля: поднимает WireGuard по конфигурации, которую положило приложение,
/// и попутно ведёт статистику — счётчики знает только этот процесс.
class PacketTunnelProvider: NEPacketTunnelProvider {
    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { logLevel, message in
            NSLog("[Overlay] \(logLevel): \(message)")
        }
    }()

    private lazy var collector: StatsCollector? = {
        guard let store = StatsStore.shared else { return nil }
        return StatsCollector(store: store) { [weak self] in
            await self?.runtimeConfiguration()
        }
    }()

    /// Счётчики из адаптера в виде UAPI-строки.
    private func runtimeConfiguration() async -> String? {
        await withCheckedContinuation { continuation in
            adapter.getRuntimeConfiguration { continuation.resume(returning: $0) }
        }
    }

    override func startTunnel(options: [String: NSObject]?) async throws {
        guard
            let proto = protocolConfiguration as? NETunnelProviderProtocol,
            let wgQuickConfig = proto.providerConfiguration?["wgQuickConfig"] as? String
        else {
            throw PacketTunnelProviderError.missingConfiguration
        }

        guard let configuration = try? TunnelConfiguration(fromWgQuickConfig: wgQuickConfig, called: "Overlay") else {
            throw PacketTunnelProviderError.invalidConfiguration
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            adapter.start(tunnelConfiguration: configuration) { error in
                if let error {
                    NSLog("[Overlay] не удалось поднять туннель: \(error)")
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }

        collector?.start()
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        await collector?.stop()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            adapter.stop { _ in continuation.resume() }
        }
    }

    /// Приложение спрашивает счётчики, пока открыт экран статистики.
    override func handleAppMessage(_ messageData: Data) async -> Data? {
        guard String(data: messageData, encoding: .utf8) == TunnelMessage.stats else { return nil }
        guard let stats = await collector?.currentStats() else { return nil }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try? encoder.encode(stats)
    }
}

enum PacketTunnelProviderError: Error {
    case missingConfiguration
    case invalidConfiguration
}
```

- [ ] **Step 3: Собрать проект с туннелем**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml
```

```bash
xcodebuild -project vpn_ios/VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -6
```

Ожидается `** BUILD SUCCEEDED **`. Симулятор здесь не годится — Go-мост туннеля под него не линкуется.

- [ ] **Step 4: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 28 тестов, 0 провалов.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/Tunnel/PacketTunnelProvider.swift vpn_ios/Shared/TunnelMessage.swift
git commit -m "feat(ios): расширение туннеля ведёт статистику и отвечает приложению"
```

---

### Task 5: Настройки в общем контейнере

Где живут режим автоподключения, доверенные сети, kill switch и последний известный баланс.

**Files:**
- Create: `vpn_ios/Shared/Preferences.swift`
- Test: `vpn_ios/Tests/PreferencesTests.swift`

**Interfaces:**
- Consumes: `AppGroup.defaults` (Task 1).
- Produces: `AutoConnectMode` (`.off`, `.always`, `.cellularOnly`, `.wifiOnly`) со свойством `title: String`; `Preferences(defaults:)`, `Preferences.shared`, свойства `autoConnectMode`, `trustedNetworks: [String]`, `killSwitch: Bool`, `lastBalance: String?`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/PreferencesTests.swift`:

```swift
import XCTest
@testable import VPN404

final class PreferencesTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!
    private var preferences: Preferences!

    override func setUp() {
        super.setUp()
        suiteName = "test.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        preferences = Preferences(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testAutoConnectDefaultsToOff() {
        XCTAssertEqual(preferences.autoConnectMode, .off)
    }

    func testAutoConnectRoundTrip() {
        preferences.autoConnectMode = .wifiOnly

        XCTAssertEqual(Preferences(defaults: defaults).autoConnectMode, .wifiOnly)
    }

    func testUnknownStoredModeFallsBackToOff() {
        defaults.set("чепуха", forKey: "autoConnectMode")

        XCTAssertEqual(preferences.autoConnectMode, .off)
    }

    func testTrustedNetworksRoundTrip() {
        preferences.trustedNetworks = ["Дом", "Офис"]

        XCTAssertEqual(Preferences(defaults: defaults).trustedNetworks, ["Дом", "Офис"])
    }

    func testKillSwitchIsOffByDefault() {
        XCTAssertFalse(preferences.killSwitch, "includeAllNetworks ломает локальную сеть — по умолчанию выключен")
    }

    func testLastBalanceRoundTrip() {
        preferences.lastBalance = "412.50"

        XCTAssertEqual(Preferences(defaults: defaults).lastBalance, "412.50")
    }

    func testEveryModeHasTitle() {
        for mode in AutoConnectMode.allCases {
            XCTAssertFalse(mode.title.isEmpty, "\(mode) без названия")
        }
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается: `cannot find 'Preferences' in scope`.

- [ ] **Step 3: Создать `vpn_ios/Shared/Preferences.swift`**

```swift
import Foundation

/// Когда приложение само поднимает туннель.
enum AutoConnectMode: String, CaseIterable, Codable {
    case off
    case always
    case cellularOnly
    case wifiOnly

    var title: String {
        switch self {
        case .off: return "Выключено"
        case .always: return "Всегда"
        case .cellularOnly: return "Только сотовая сеть"
        case .wifiOnly: return "Только Wi-Fi"
        }
    }
}

/// Настройки, общие для приложения, расширения и виджетов.
struct Preferences {
    private let defaults: UserDefaults

    init(defaults: UserDefaults) { self.defaults = defaults }

    static var shared: Preferences { Preferences(defaults: AppGroup.defaults ?? .standard) }

    var autoConnectMode: AutoConnectMode {
        get { AutoConnectMode(rawValue: defaults.string(forKey: Key.autoConnect) ?? "") ?? .off }
        nonmutating set { defaults.set(newValue.rawValue, forKey: Key.autoConnect) }
    }

    /// Сети, в которых туннель поднимать не нужно. Имена вводятся вручную:
    /// подставить текущее имя Wi-Fi мы могли бы только ценой доступа к геопозиции.
    var trustedNetworks: [String] {
        get { defaults.stringArray(forKey: Key.trusted) ?? [] }
        nonmutating set { defaults.set(newValue, forKey: Key.trusted) }
    }

    /// По умолчанию выключен: includeAllNetworks ломает AirPlay, печать и локальную сеть.
    var killSwitch: Bool {
        get { defaults.bool(forKey: Key.killSwitch) }
        nonmutating set { defaults.set(newValue, forKey: Key.killSwitch) }
    }

    /// Последний известный баланс — чтобы виджет показывал его без похода в сеть.
    var lastBalance: String? {
        get { defaults.string(forKey: Key.balance) }
        nonmutating set { defaults.set(newValue, forKey: Key.balance) }
    }

    private enum Key {
        static let autoConnect = "autoConnectMode"
        static let trusted = "trustedNetworks"
        static let killSwitch = "killSwitch"
        static let balance = "lastBalance"
    }
}
```

- [ ] **Step 4: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 35 тестов, 0 провалов.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/Shared/Preferences.swift vpn_ios/Tests/PreferencesTests.swift
git commit -m "feat(ios): общие настройки автоподключения и защиты"
```

---

### Task 6: Правила автоподключения и сборка профиля

Две чистые функции, в которых сосредоточена вся логика: какие правила `NEOnDemandRule` собрать и включать ли их вообще. Здесь же живёт защита от «нулевой баланс плюс автоподключение равно нет интернета».

**Files:**
- Create: `vpn_ios/App/OnDemandRules.swift`
- Create: `vpn_ios/App/TunnelProfileBuilder.swift`
- Test: `vpn_ios/Tests/OnDemandRulesTests.swift`
- Test: `vpn_ios/Tests/TunnelProfileBuilderTests.swift`

**Interfaces:**
- Consumes: `AutoConnectMode` (Task 5), `TunnelConfig` из `App/Api.swift`, `VPNManager.displayName`.
- Produces: `OnDemandRules.rules(mode:trustedNetworks:) -> [NEOnDemandRule]`; `TunnelProfileSettings(serverAddress:wgQuickConfig:includeAllNetworks:onDemandEnabled:)`; `TunnelProfileBuilder.settings(config:killSwitch:autoConnect:accountSuspended:) -> TunnelProfileSettings`.

- [ ] **Step 1: Написать падающий тест для правил**

Создать `vpn_ios/Tests/OnDemandRulesTests.swift`:

```swift
import NetworkExtension
import XCTest
@testable import VPN404

final class OnDemandRulesTests: XCTestCase {
    func testOffProducesNoRules() {
        XCTAssertTrue(OnDemandRules.rules(mode: .off, trustedNetworks: []).isEmpty)
    }

    func testAlwaysConnectsOnAnyInterface() {
        let rules = OnDemandRules.rules(mode: .always, trustedNetworks: [])

        XCTAssertEqual(rules.count, 1)
        XCTAssertEqual(rules[0].action, .connect)
        XCTAssertEqual(rules[0].interfaceTypeMatch, .any)
    }

    func testCellularOnlyConnectsOnCellularAndDisconnectsOnWiFi() {
        let rules = OnDemandRules.rules(mode: .cellularOnly, trustedNetworks: [])

        XCTAssertEqual(rules.map(\.action), [.connect, .disconnect])
        XCTAssertEqual(rules[0].interfaceTypeMatch, .cellular)
        XCTAssertEqual(rules[1].interfaceTypeMatch, .wiFi)
    }

    func testWifiOnlyConnectsOnWiFiAndDisconnectsOnCellular() {
        let rules = OnDemandRules.rules(mode: .wifiOnly, trustedNetworks: [])

        XCTAssertEqual(rules.map(\.action), [.connect, .disconnect])
        XCTAssertEqual(rules[0].interfaceTypeMatch, .wiFi)
        XCTAssertEqual(rules[1].interfaceTypeMatch, .cellular)
    }

    func testTrustedNetworksRuleComesFirst() {
        let rules = OnDemandRules.rules(mode: .always, trustedNetworks: ["Дом"])

        XCTAssertEqual(rules.first?.action, .disconnect,
                       "правила разбираются по порядку: доверенная сеть должна отсекаться раньше подключения")
        XCTAssertEqual(rules.first?.interfaceTypeMatch, .wiFi)
        XCTAssertEqual(rules.first?.ssidMatch, ["Дом"])
    }

    func testTrustedNetworksIgnoredWhenModeIsOff() {
        XCTAssertTrue(OnDemandRules.rules(mode: .off, trustedNetworks: ["Дом"]).isEmpty)
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается: `cannot find 'OnDemandRules' in scope`.

- [ ] **Step 3: Создать `vpn_ios/App/OnDemandRules.swift`**

```swift
import NetworkExtension

/// Сборка правил, по которым система сама поднимает туннель.
///
/// Вынесено в чистую функцию: правила разбираются по порядку и первое совпавшее
/// побеждает, так что порядок здесь — не косметика, а поведение. Его проверяет тест.
enum OnDemandRules {
    static func rules(mode: AutoConnectMode, trustedNetworks: [String]) -> [NEOnDemandRule] {
        guard mode != .off else { return [] }

        var rules: [NEOnDemandRule] = []

        // сначала исключения, иначе правило подключения перехватит доверенную сеть
        if !trustedNetworks.isEmpty {
            let skip = NEOnDemandRuleDisconnect()
            skip.interfaceTypeMatch = .wiFi
            skip.ssidMatch = trustedNetworks
            rules.append(skip)
        }

        switch mode {
        case .off:
            break
        case .always:
            let connect = NEOnDemandRuleConnect()
            connect.interfaceTypeMatch = .any
            rules.append(connect)
        case .cellularOnly:
            let connect = NEOnDemandRuleConnect()
            connect.interfaceTypeMatch = .cellular
            let disconnect = NEOnDemandRuleDisconnect()
            disconnect.interfaceTypeMatch = .wiFi
            rules.append(contentsOf: [connect, disconnect])
        case .wifiOnly:
            let connect = NEOnDemandRuleConnect()
            connect.interfaceTypeMatch = .wiFi
            let disconnect = NEOnDemandRuleDisconnect()
            disconnect.interfaceTypeMatch = .cellular
            rules.append(contentsOf: [connect, disconnect])
        }

        return rules
    }
}
```

- [ ] **Step 4: Написать падающий тест для сборки профиля**

Создать `vpn_ios/Tests/TunnelProfileBuilderTests.swift`:

```swift
import XCTest
@testable import VPN404

final class TunnelProfileBuilderTests: XCTestCase {
    private let config = TunnelConfig(
        privateKey: "aaa",
        address: "10.8.0.5/24",
        dns: ["1.1.1.1"],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))

    func testServerAddressIsAppNameNotIP() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .off, accountSuspended: false)

        XCTAssertEqual(settings.serverAddress, "Overlay")
        XCTAssertFalse(settings.serverAddress.contains("195.14"), "IP сервера пользователю показывать незачем")
    }

    func testKillSwitchMapsToIncludeAllNetworks() {
        let on = TunnelProfileBuilder.settings(config: config, killSwitch: true,
                                               autoConnect: .off, accountSuspended: false)
        let off = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                autoConnect: .off, accountSuspended: false)

        XCTAssertTrue(on.includeAllNetworks)
        XCTAssertFalse(off.includeAllNetworks)
    }

    func testOnDemandEnabledWhenModeSet() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .always, accountSuspended: false)

        XCTAssertTrue(settings.onDemandEnabled)
    }

    func testSuspendedAccountDisablesOnDemand() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .always, accountSuspended: true)

        XCTAssertFalse(settings.onDemandEnabled,
                       "при нулевом балансе пир выключен на сервере: правила оставили бы человека без интернета")
    }

    func testConfigTextIsCarriedThrough() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .off, accountSuspended: false)

        XCTAssertEqual(settings.wgQuickConfig, config.wgQuickConfig)
    }
}
```

- [ ] **Step 5: Создать `vpn_ios/App/TunnelProfileBuilder.swift`**

```swift
import Foundation

/// Что именно записать в системный профиль туннеля.
struct TunnelProfileSettings: Equatable {
    var serverAddress: String
    var wgQuickConfig: String
    var includeAllNetworks: Bool
    var onDemandEnabled: Bool
}

/// Решение отделено от его применения: `VPNManager` только раскладывает эти значения
/// по `NETunnelProviderManager`, а сама логика проверяется тестом.
enum TunnelProfileBuilder {
    static func settings(config: TunnelConfig,
                         killSwitch: Bool,
                         autoConnect: AutoConnectMode,
                         accountSuspended: Bool) -> TunnelProfileSettings {
        TunnelProfileSettings(
            // поле только для показа: адрес подключения система берёт из конфигурации WireGuard
            serverAddress: VPNManager.displayName,
            wgQuickConfig: config.wgQuickConfig,
            includeAllNetworks: killSwitch,
            // при исчерпанном балансе сервер выключает пир: туннель не поднимется никогда,
            // а правила будут блокировать трафик — человек останется вообще без интернета
            onDemandEnabled: autoConnect != .off && !accountSuspended)
    }
}
```

- [ ] **Step 6: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 46 тестов, 0 провалов.

- [ ] **Step 7: Коммит**

```bash
git add vpn_ios/App/OnDemandRules.swift vpn_ios/App/TunnelProfileBuilder.swift vpn_ios/Tests/OnDemandRulesTests.swift vpn_ios/Tests/TunnelProfileBuilderTests.swift
git commit -m "feat(ios): правила автоподключения и сборка профиля туннеля"
```

---

### Task 7: VPNManager применяет правила и умеет спрашивать счётчики

Единственное место, которое трогает NetworkExtension, получает всё, что подготовили чистые функции.

**Files:**
- Modify: `vpn_ios/App/VPNManager.swift`

**Interfaces:**
- Consumes: `TunnelProfileBuilder.settings(...)`, `OnDemandRules.rules(...)` (Task 6), `TunnelMessage.stats` (Task 4), `Preferences.shared` (Task 5).
- Produces: `VPNManager.install(config:killSwitch:autoConnect:accountSuspended:) async throws`, `VPNManager.requestStats() async -> TunnelStats?`, `VPNManager.applyPreferences(autoConnect:trustedNetworks:killSwitch:accountSuspended:) async`.

- [ ] **Step 1: Переписать метод `install` и добавить два новых**

В `vpn_ios/App/VPNManager.swift` заменить метод `install(config:)` целиком на приведённый ниже и добавить `applyPreferences` и `requestStats`. Остальное в файле (инициализатор, `loadExisting`, `connect`, `disconnect`, `removeProfile`, `displayName`, расширение `NEVPNStatus`) не трогать.

```swift
    /// Создаёт или обновляет профиль туннеля из конфигурации, полученной с бэкенда.
    func install(config: TunnelConfig,
                 killSwitch: Bool,
                 autoConnect: AutoConnectMode,
                 trustedNetworks: [String],
                 accountSuspended: Bool) async throws {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: killSwitch,
                                                     autoConnect: autoConnect,
                                                     accountSuspended: accountSuspended)

        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        let target = managers.first ?? NETunnelProviderManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "co.404studio.vpn.tunnel"
        // Только для показа в системных настройках: адрес подключения система берёт
        // из конфигурации WireGuard внутри providerConfiguration, а не отсюда.
        proto.serverAddress = settings.serverAddress
        proto.includeAllNetworks = settings.includeAllNetworks
        // Конфиг лежит в системном хранилище профиля, а не в файлах приложения
        proto.providerConfiguration = ["wgQuickConfig": settings.wgQuickConfig]

        target.protocolConfiguration = proto
        target.localizedDescription = Self.displayName
        target.onDemandRules = OnDemandRules.rules(mode: autoConnect, trustedNetworks: trustedNetworks)
        target.isOnDemandEnabled = settings.onDemandEnabled
        target.isEnabled = true

        try await target.saveToPreferences()
        // Перечитываем: после сохранения система выдаёт актуальный объект
        try await target.loadFromPreferences()

        manager = target
        status = target.connection.status
    }

    /// Обновляет правила и защиту у уже установленного профиля, не трогая конфигурацию.
    /// Нужно, когда человек поменял настройки или когда баланс ушёл в ноль.
    func applyPreferences(autoConnect: AutoConnectMode,
                          trustedNetworks: [String],
                          killSwitch: Bool,
                          accountSuspended: Bool) async {
        guard let manager else { return }
        (manager.protocolConfiguration as? NETunnelProviderProtocol)?.includeAllNetworks = killSwitch
        manager.onDemandRules = OnDemandRules.rules(mode: autoConnect, trustedNetworks: trustedNetworks)
        manager.isOnDemandEnabled = autoConnect != .off && !accountSuspended
        try? await manager.saveToPreferences()
        try? await manager.loadFromPreferences()
    }

    /// Спрашивает у расширения текущие счётчики. Работает только пока туннель поднят.
    func requestStats() async -> TunnelStats? {
        guard let session = manager?.connection as? NETunnelProviderSession,
              let request = TunnelMessage.stats.data(using: .utf8)
        else { return nil }

        return await withCheckedContinuation { continuation in
            do {
                try session.sendProviderMessage(request) { response in
                    guard let response else { return continuation.resume(returning: nil) }
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = .iso8601
                    continuation.resume(returning: try? decoder.decode(TunnelStats.self, from: response))
                }
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }
```

- [ ] **Step 2: Обновить вызов в `AppState.installTunnel`**

В `vpn_ios/App/AppState.swift` метод `installTunnel(into:)` вызывает `vpn.install(config:)` со старой сигнатурой. Заменить тело метода на:

```swift
    /// Забирает конфигурацию туннеля и ставит её в системный профиль.
    func installTunnel(into vpn: VPNManager) async -> Bool {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let config = try await api.tunnel()
            let preferences = Preferences.shared
            try await vpn.install(config: config,
                                  killSwitch: preferences.killSwitch,
                                  autoConnect: preferences.autoConnectMode,
                                  trustedNetworks: preferences.trustedNetworks,
                                  accountSuspended: me?.isSuspended == true)
            return true
        } catch {
            handle(error)
            return false
        }
    }
```

- [ ] **Step 3: Собрать оба проекта**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml
```

```bash
xcodebuild -project vpn_ios/VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -4
```

Ожидается `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 46 тестов, 0 провалов.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/App/VPNManager.swift vpn_ios/App/AppState.swift
git commit -m "feat(ios): применение правил автоподключения и запрос счётчиков по IPC"
```

---

### Task 8: Форматирование и карточки приборной панели

Мелкие кирпичи, из которых собраны все три экрана. Отдельной задачей — потому что форматирование трафика легко проверить тестом, а потом просто пользоваться.

**Files:**
- Create: `vpn_ios/Shared/TrafficFormatter.swift`
- Create: `vpn_ios/App/Components/StatCard.swift`
- Test: `vpn_ios/Tests/TrafficFormatterTests.swift`

**Interfaces:**
- Produces: `TrafficFormatter.bytes(_ value: UInt64) -> String`, `TrafficFormatter.duration(_ seconds: TimeInterval) -> String`; вьюхи `StatCard(label:value:caption:)` и `MiniStat(label:value:tint:)`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/TrafficFormatterTests.swift`:

```swift
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
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается: `cannot find 'TrafficFormatter' in scope`.

- [ ] **Step 3: Создать `vpn_ios/Shared/TrafficFormatter.swift`**

```swift
import Foundation

/// Числа для приборной панели: байты и длительности в человеческом виде.
enum TrafficFormatter {
    private static let units = ["Б", "КБ", "МБ", "ГБ", "ТБ"]

    static func bytes(_ value: UInt64) -> String {
        var amount = Double(value)
        var unit = 0
        while amount >= 1024 && unit < units.count - 1 {
            amount /= 1024
            unit += 1
        }
        if unit == 0 { return "\(Int(amount)) \(units[unit])" }
        return String(format: "%.1f", amount).replacingOccurrences(of: ".", with: ",") + " \(units[unit])"
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(max(0, seconds))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        return hours > 0 ? "\(hours) ч \(minutes) мин" : "\(minutes) мин"
    }
}
```

- [ ] **Step 4: Создать `vpn_ios/App/Components/StatCard.swift`**

```swift
import SwiftUI

/// Крупная карточка приборной панели: подпись, число, пояснение.
struct StatCard<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: label)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// Число моноширинным — как на приборах.
struct StatValue: View {
    let text: String
    var unit: String?
    var size: CGFloat = 32

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(text)
                .font(.system(size: size, weight: .heavy, design: .monospaced))
                .foregroundStyle(Theme.fg)
            if let unit {
                Text(unit)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.muted)
            }
        }
    }
}

/// Половинка ряда из двух маленьких карточек.
struct MiniStat: View {
    let label: String
    let value: String
    var tint: Color = Theme.fg

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: label)
            Text(value)
                .font(Theme.mono(12))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
```

- [ ] **Step 5: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 52 теста, 0 провалов.

- [ ] **Step 6: Коммит**

```bash
git add vpn_ios/Shared/TrafficFormatter.swift vpn_ios/App/Components/StatCard.swift vpn_ios/Tests/TrafficFormatterTests.swift
git commit -m "feat(ios): форматирование трафика и карточки приборной панели"
```

---

### Task 9: Агрегация статистики по дням

Пересчёт сессий в столбики графика. Чистая функция, поэтому отдельно и с тестом — экран статистики потом просто её вызовет.

**Files:**
- Create: `vpn_ios/Shared/StatsAggregator.swift`
- Test: `vpn_ios/Tests/StatsAggregatorTests.swift`

**Interfaces:**
- Consumes: `SessionRecord` (Task 1).
- Produces: `StatsPeriod` (`.day`, `.week`, `.month`) со свойствами `title: String` и `days: Int`; `DailyTraffic(day:rxBytes:txBytes:)` со свойством `totalBytes: UInt64`; `StatsAggregator.byDay(_:calendar:) -> [DailyTraffic]`; `StatsAggregator.sessions(_:in:now:calendar:) -> [SessionRecord]`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/StatsAggregatorTests.swift`:

```swift
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
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | tail -20
```

Ожидается: `cannot find 'StatsAggregator' in scope`.

- [ ] **Step 3: Создать `vpn_ios/Shared/StatsAggregator.swift`**

```swift
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
```

- [ ] **Step 4: Прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 58 тестов, 0 провалов.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/Shared/StatsAggregator.swift vpn_ios/Tests/StatsAggregatorTests.swift
git commit -m "feat(ios): агрегация статистики по дням и периодам"
```

---

### Task 10: Дашборд и вкладки

Первое видимое изменение: вместо одного экрана с круглой кнопкой — три вкладки, на первой приборная панель.

**Files:**
- Create: `vpn_ios/App/Screens/RootView.swift`
- Create: `vpn_ios/App/Screens/DashboardView.swift`
- Modify: `vpn_ios/App/App.swift`
- Delete: `vpn_ios/App/HomeView.swift`

**Interfaces:**
- Consumes: `AppState`, `VPNManager` (Task 7), `StatCard`, `StatValue`, `MiniStat`, `TrafficFormatter` (Task 8), `Preferences` (Task 5), `StatsStore.shared` (Task 1).
- Produces: `RootView`, `DashboardView`. `RootView` создаёт единственный `VPNManager` и кладёт его в окружение — остальные экраны берут его через `@EnvironmentObject`.

- [ ] **Step 1: Создать `vpn_ios/App/Screens/RootView.swift`**

```swift
import SwiftUI

/// Три вкладки. Менеджер VPN создаётся здесь в единственном экземпляре:
/// иначе каждая вкладка завела бы свой и статусы разъехались бы.
struct RootView: View {
    @StateObject private var vpn = VPNManager()

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Соединение", systemImage: "shield.lefthalf.filled") }
            StatsView()
                .tabItem { Label("Статистика", systemImage: "chart.bar.fill") }
            SettingsView()
                .tabItem { Label("Настройки", systemImage: "gearshape.fill") }
        }
        .environmentObject(vpn)
        .tint(Theme.accent)
        .preferredColorScheme(.dark)
        .task { await vpn.loadExisting() }
    }
}
```

- [ ] **Step 2: Создать `vpn_ios/App/Screens/DashboardView.swift`**

```swift
import NetworkExtension
import SwiftUI

/// Приборная панель: состояние туннеля, живой трафик, режимы, баланс.
struct DashboardView: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var vpn: VPNManager

    @State private var stats: TunnelStats = .empty
    @State private var speedHistory: [Double] = []

    private var isConnected: Bool { vpn.status == .connected }

    var body: some View {
        ZStack {
            GridBackground()
            ScrollView {
                VStack(spacing: 12) {
                    header
                    connectButton
                    if state.me?.isSuspended == true { suspendedNotice }
                    if isConnected { trafficCard }
                    modeRow
                    balanceCard
                    if let message = state.errorMessage { errorText(message) }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .task {
            await state.refresh()
            stats = StatsStore.shared?.readSnapshot() ?? .empty
        }
        .task(id: vpn.status) { await pollStats() }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 0) {
                Text("404").foregroundStyle(Theme.accent)
                Text("/OVERLAY").foregroundStyle(Theme.fg)
            }
            .font(.system(size: 18, weight: .heavy))
            Spacer()
            Eyebrow(text: statusLabel, color: statusColor)
        }
        .padding(.top, 8)
    }

    private var statusLabel: String {
        if state.me?.isSuspended == true { return "приостановлен" }
        return isConnected ? "защищено" : "не защищено"
    }

    private var statusColor: Color {
        if state.me?.isSuspended == true { return Theme.warn }
        return isConnected ? Theme.accent : Theme.muted
    }

    /// Широкая кнопка вместо круглой: круг со свечением — самый копируемый
    /// VPN-интерфейс, из-за него в том числе и прилетел отказ по 4.3.
    private var connectButton: some View {
        Button {
            Task { await toggle() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isConnected ? "bolt.fill" : "power")
                Text(isConnected ? "Отключить" : "Подключить")
                    .font(.system(size: 16, weight: .bold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .foregroundStyle(isConnected ? Theme.accent : Theme.fg)
            .background(isConnected ? Theme.accentSoft : Theme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .strokeBorder(isConnected ? Theme.accent : Theme.borderStrong, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .disabled(state.isBusy || vpn.status.isBusy || state.me?.isSuspended == true)
        .opacity(state.isBusy || vpn.status.isBusy ? 0.6 : 1)
    }

    private var suspendedNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "доступ приостановлен", color: Theme.warn)
            Text("Баланс закончился. Пополните его в боте — доступ вернётся, а автоподключение включится обратно.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var trafficCard: some View {
        StatCard(label: "трафик сейчас") {
            StatValue(text: TrafficFormatter.bytes(UInt64(currentSpeed)), unit: "/с")
            Sparkline(values: speedHistory)
                .frame(height: 34)
        }
    }

    private var modeRow: some View {
        HStack(spacing: 10) {
            MiniStat(label: "автовкл",
                     value: Preferences.shared.autoConnectMode.title,
                     tint: Preferences.shared.autoConnectMode == .off ? Theme.muted : Theme.accent)
            MiniStat(label: "принято",
                     value: TrafficFormatter.bytes(stats.rxBytes))
        }
    }

    private var balanceCard: some View {
        StatCard(label: "баланс") {
            StatValue(text: state.me?.balance ?? "—", unit: "₽")
            Text(balanceSubtitle)
                .font(Theme.mono(12))
                .foregroundStyle(Theme.muted)
        }
    }

    private var balanceSubtitle: String {
        guard let me = state.me else { return "загружаем…" }
        guard let days = me.daysLeft else { return "без списаний · нет устройств" }
        return "≈ \(days) дн. · устройств: \(me.devices)"
    }

    private func errorText(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 13))
            .foregroundStyle(Theme.danger)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var currentSpeed: Double { speedHistory.last ?? 0 }

    private func toggle() async {
        if isConnected {
            vpn.disconnect()
            return
        }
        // конфиг всегда берём свежий: сервер мог отключить пир при нулевом балансе
        guard await state.installTunnel(into: vpn) else { return }
        do {
            try vpn.connect()
        } catch {
            state.errorMessage = "Не удалось запустить туннель"
        }
    }

    /// Живой график: раз в секунду спрашиваем расширение напрямую.
    /// Цикл живёт, только пока туннель поднят, — task(id:) перезапускает его при смене статуса.
    private func pollStats() async {
        guard isConnected else { return }
        var previous = stats
        while !Task.isCancelled && vpn.status == .connected {
            if let fresh = await vpn.requestStats() {
                let elapsed = fresh.capturedAt.timeIntervalSince(previous.capturedAt)
                if elapsed > 0 {
                    let delta = Double(fresh.rxBytes &+ fresh.txBytes)
                        - Double(previous.rxBytes &+ previous.txBytes)
                    speedHistory.append(max(0, delta / elapsed))
                    if speedHistory.count > 24 { speedHistory.removeFirst() }
                }
                previous = fresh
                stats = fresh
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }
}

/// Столбики скорости — без Charts, чтобы дашборд оставался лёгким.
struct Sparkline: View {
    let values: [Double]

    var body: some View {
        GeometryReader { geometry in
            let peak = max(values.max() ?? 1, 1)
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Theme.accent.opacity(0.85))
                        .frame(height: max(2, geometry.size.height * value / peak))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}
```

- [ ] **Step 3: Заменить корень в `vpn_ios/App/App.swift`**

Заменить содержимое файла на:

```swift
import SwiftUI

@main
struct VPN404App: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            if state.hasToken {
                RootView().environmentObject(state)
            } else {
                RedeemView().environmentObject(state)
            }
        }
    }
}
```

- [ ] **Step 4: Удалить старый экран**

```bash
git rm vpn_ios/App/HomeView.swift
```

Отвязка устройства из него переезжает в `SettingsView` (Task 12). До тех пор она временно недоступна — это нормально, задачи идут подряд.

- [ ] **Step 5: Собрать и снять скриншот**

`StatsView` и `SettingsView` ещё не существуют, поэтому проект не соберётся. Создать заглушки, которые следующие задачи заменят целиком:

```swift
// vpn_ios/App/Screens/StatsView.swift
import SwiftUI

struct StatsView: View {
    var body: some View { ZStack { GridBackground() } }
}
```

```swift
// vpn_ios/App/Screens/SettingsView.swift
import SwiftUI

struct SettingsView: View {
    var body: some View { ZStack { GridBackground() } }
}
```

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml
```

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 58 тестов, 0 провалов.

- [ ] **Step 6: Коммит**

```bash
git add vpn_ios/App/Screens vpn_ios/App/App.swift
git commit -m "feat(ios): вкладки и дашборд вместо экрана с круглой кнопкой"
```

---

### Task 11: Экран статистики

График по дням, итоги за период, история сессий.

**Files:**
- Modify: `vpn_ios/App/Screens/StatsView.swift` (заменить заглушку из Task 10)
- Create: `vpn_ios/App/Components/TrafficChart.swift`

**Interfaces:**
- Consumes: `StatsStore.shared`, `StatsAggregator.byDay`, `StatsAggregator.sessions(_:in:now:calendar:)`, `StatsPeriod`, `DailyTraffic`, `TrafficFormatter`, `SessionRecord.duration(now:)`.

- [ ] **Step 1: Создать `vpn_ios/App/Components/TrafficChart.swift`**

```swift
import Charts
import SwiftUI

/// Столбчатый график трафика по дням. Swift Charts есть с iOS 16 — сторонних зависимостей не нужно.
struct TrafficChart: View {
    let days: [DailyTraffic]

    var body: some View {
        Chart(days) { day in
            BarMark(
                x: .value("День", day.day, unit: .day),
                y: .value("Трафик", Double(day.totalBytes) / 1_048_576)
            )
            .foregroundStyle(Theme.accent.opacity(0.85))
            .cornerRadius(2)
        }
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(Theme.border)
                AxisValueLabel {
                    if let megabytes = value.as(Double.self) {
                        Text("\(Int(megabytes)) МБ")
                            .font(Theme.mono(9))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day)) { value in
                AxisValueLabel(format: .dateTime.day().month(.narrow))
                    .font(Theme.mono(9))
                    .foregroundStyle(Theme.muted)
            }
        }
    }
}
```

- [ ] **Step 2: Заменить `vpn_ios/App/Screens/StatsView.swift`**

```swift
import SwiftUI

/// Статистика: график по дням, итоги за период, история подключений.
struct StatsView: View {
    @State private var period: StatsPeriod = .week
    @State private var sessions: [SessionRecord] = []

    private var visible: [SessionRecord] { StatsAggregator.sessions(sessions, in: period) }
    private var days: [DailyTraffic] { StatsAggregator.byDay(visible) }

    var body: some View {
        ZStack {
            GridBackground()
            ScrollView {
                VStack(spacing: 12) {
                    picker
                    if visible.isEmpty { emptyState } else { chart; totals; history }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .task { sessions = StatsStore.shared?.readSessions() ?? [] }
    }

    private var picker: some View {
        Picker("Период", selection: $period) {
            ForEach(StatsPeriod.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .padding(.top, 12)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("Пока нечего показать")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.fg)
            Text("Данные появятся после первого подключения: приложение считает трафик само, на устройстве.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .card()
    }

    private var chart: some View {
        StatCard(label: "трафик по дням") {
            TrafficChart(days: days).frame(height: 150)
        }
    }

    private var totals: some View {
        HStack(spacing: 10) {
            MiniStat(label: "принято", value: TrafficFormatter.bytes(visible.reduce(0) { $0 + $1.rxBytes }))
            MiniStat(label: "отправлено", value: TrafficFormatter.bytes(visible.reduce(0) { $0 + $1.txBytes }))
            MiniStat(label: "под защитой",
                     value: TrafficFormatter.duration(visible.reduce(0) { $0 + $1.duration() }))
        }
    }

    private var history: some View {
        StatCard(label: "подключения") {
            VStack(spacing: 0) {
                ForEach(visible.sorted { $0.startedAt > $1.startedAt }) { session in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.startedAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.fg)
                            Text(TrafficFormatter.duration(session.duration()))
                                .font(Theme.mono(10))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Text(TrafficFormatter.bytes(session.totalBytes))
                            .font(Theme.mono(12))
                            .foregroundStyle(Theme.fgSoft)
                    }
                    .padding(.vertical, 9)
                    if session.id != visible.sorted(by: { $0.startedAt > $1.startedAt }).last?.id {
                        Divider().overlay(Theme.border)
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 3: Собрать и прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 58 тестов, 0 провалов.

- [ ] **Step 4: Проверить пустое состояние глазами**

```bash
xcrun simctl boot "iPhone 17" 2>/dev/null; xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/VPN404UI-*/Build/Products/Debug-iphonesimulator/VPN404.app && SIMCTL_CHILD_UI_PREVIEW_HOME=1 xcrun simctl launch booted co.404studio.vpn
```

Перейти на вкладку «Статистика» — должно быть видно объяснение про первое подключение, а не пустой экран.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/App/Screens/StatsView.swift vpn_ios/App/Components/TrafficChart.swift
git commit -m "feat(ios): экран статистики с графиком и историей сессий"
```

---

### Task 12: Экран настроек

Автоподключение, доверенные сети, kill switch, отвязка устройства.

**Files:**
- Modify: `vpn_ios/App/Screens/SettingsView.swift` (заменить заглушку из Task 10)

**Interfaces:**
- Consumes: `Preferences` (Task 5), `AutoConnectMode`, `VPNManager.applyPreferences(...)` (Task 7), `AppState.unlinkDevice(from:)`.

- [ ] **Step 1: Заменить `vpn_ios/App/Screens/SettingsView.swift`**

```swift
import SwiftUI

/// Настройки: когда подключаться само, насколько строго защищать, что с устройством.
struct SettingsView: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var vpn: VPNManager

    @State private var mode: AutoConnectMode = Preferences.shared.autoConnectMode
    @State private var trusted: [String] = Preferences.shared.trustedNetworks
    @State private var killSwitch: Bool = Preferences.shared.killSwitch
    @State private var newNetwork = ""
    @State private var confirmingUnlink = false

    var body: some View {
        ZStack {
            GridBackground()
            ScrollView {
                VStack(spacing: 12) {
                    autoConnectSection
                    trustedSection
                    protectionSection
                    deviceSection
                    aboutSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
        }
    }

    private var autoConnectSection: some View {
        StatCard(label: "автоподключение") {
            Picker("Режим", selection: $mode) {
                ForEach(AutoConnectMode.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
            .onChange(of: mode) { _ in persist() }

            if mode != .off && state.me?.isSuspended == true {
                Text("Пока баланс на нуле, автоподключение отключено: туннель всё равно не поднимется, а система заблокирует трафик.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.warn)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var trustedSection: some View {
        StatCard(label: "доверенные сети") {
            Text("В этих сетях туннель поднимать не нужно. Имя вводится вручную — так приложению не требуется доступ к геопозиции.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(trusted, id: \.self) { network in
                HStack {
                    Text(network).font(.system(size: 14)).foregroundStyle(Theme.fg)
                    Spacer()
                    Button {
                        trusted.removeAll { $0 == network }
                        persist()
                    } label: {
                        Image(systemName: "minus.circle").foregroundStyle(Theme.danger)
                    }
                }
                .padding(.vertical, 6)
            }

            HStack {
                TextField("Имя сети", text: $newNetwork)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 14))
                Button("Добавить") {
                    let name = newNetwork.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty, !trusted.contains(name) else { return }
                    trusted.append(name)
                    newNetwork = ""
                    persist()
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .disabled(newNetwork.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private var protectionSection: some View {
        StatCard(label: "защита") {
            Toggle("Kill switch", isOn: $killSwitch)
                .font(.system(size: 14))
                .tint(Theme.accent)
                .onChange(of: killSwitch) { _ in persist() }
            Text("Не выпускает трафик мимо туннеля. Побочный эффект: перестают работать AirPlay, печать и устройства в локальной сети.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var deviceSection: some View {
        StatCard(label: "устройство") {
            if let me = state.me {
                Text(me.deviceName ?? "это устройство")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.fg)
                Text("баланс \(me.balance) ₽")
                    .font(Theme.mono(11))
                    .foregroundStyle(Theme.muted)
            }

            if confirmingUnlink {
                Text("Устройство отвяжется, списание за него прекратится. Чтобы вернуться, понадобится новый код из бота.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button("Отмена") { confirmingUnlink = false }
                        .buttonStyle(.plain)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.fgSoft)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radius)
                            .strokeBorder(Theme.borderStrong, lineWidth: 1))
                    Button("Отвязать") {
                        Task {
                            vpn.disconnect()
                            await state.unlinkDevice(from: vpn)
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius)
                        .strokeBorder(Theme.danger, lineWidth: 1))
                }
            } else {
                Button("Отвязать устройство") { confirmingUnlink = true }
                    .buttonStyle(.plain)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    private var aboutSection: some View {
        StatCard(label: "о приложении") {
            Text("Overlay \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
                .font(Theme.mono(11))
                .foregroundStyle(Theme.muted)
            Text("Приложение не запрашивает геопозицию, контакты и фотографии.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Сохраняет настройки и сразу применяет их к профилю — иначе изменения
    /// вступили бы в силу только после следующего подключения.
    private func persist() {
        let preferences = Preferences.shared
        preferences.autoConnectMode = mode
        preferences.trustedNetworks = trusted
        preferences.killSwitch = killSwitch
        Task {
            await vpn.applyPreferences(autoConnect: mode,
                                       trustedNetworks: trusted,
                                       killSwitch: killSwitch,
                                       accountSuspended: state.me?.isSuspended == true)
        }
    }
}
```

- [ ] **Step 2: Собрать и прогнать тесты**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 58 тестов, 0 провалов.

- [ ] **Step 3: Коммит**

```bash
git add vpn_ios/App/Screens/SettingsView.swift
git commit -m "feat(ios): экран настроек с автоподключением, kill switch и отвязкой"
```

---

### Task 13: Правила снимаются при нулевом балансе

Связывает обновление аккаунта с профилем: как только сервер сказал `suspended`, автоподключение выключается, а после пополнения — возвращается.

**Files:**
- Modify: `vpn_ios/App/AppState.swift`
- Modify: `vpn_ios/App/Screens/DashboardView.swift`
- Test: `vpn_ios/Tests/SuspendedAccountTests.swift`

**Interfaces:**
- Consumes: `TunnelProfileBuilder.settings(...)` (Task 6), `VPNManager.applyPreferences(...)` (Task 7).
- Produces: `AppState.syncProfileWithAccount(vpn:) async`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/SuspendedAccountTests.swift`:

```swift
import XCTest
@testable import VPN404

/// Самый опасный краевой случай всей переделки: правила автоподключения при
/// выключенном на сервере пире оставляют человека вообще без интернета.
final class SuspendedAccountTests: XCTestCase {
    private let config = TunnelConfig(
        privateKey: "aaa", address: "10.8.0.5/24", dns: ["1.1.1.1"],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))

    func testOnDemandStaysOffForEveryModeWhileSuspended() {
        for mode in AutoConnectMode.allCases {
            let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                         autoConnect: mode, accountSuspended: true)
            XCTAssertFalse(settings.onDemandEnabled, "режим \(mode) не должен включать правила при suspended")
        }
    }

    func testOnDemandComesBackAfterTopUp() {
        let suspended = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                      autoConnect: .always, accountSuspended: true)
        let restored = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .always, accountSuspended: false)

        XCTAssertFalse(suspended.onDemandEnabled)
        XCTAssertTrue(restored.onDemandEnabled, "после пополнения правила возвращаются сами")
    }

    func testKillSwitchIsIndependentOfSuspension() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: true,
                                                     autoConnect: .off, accountSuspended: true)

        XCTAssertTrue(settings.includeAllNetworks)
    }
}
```

- [ ] **Step 2: Убедиться, что тест проходит**

Логика уже заложена в `TunnelProfileBuilder` (Task 6), поэтому тест должен пройти сразу — он фиксирует поведение, чтобы его не сломали позже.

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

Ожидается: 61 тест, 0 провалов.

- [ ] **Step 3: Добавить синхронизацию профиля в `AppState`**

В `vpn_ios/App/AppState.swift` добавить метод:

```swift
    /// Приводит профиль в соответствие с состоянием аккаунта.
    /// Вызывается после каждого обновления: баланс мог кончиться или пополниться,
    /// и правила автоподключения обязаны следовать за ним.
    func syncProfileWithAccount(vpn: VPNManager) async {
        let preferences = Preferences.shared
        preferences.lastBalance = me?.balance
        await vpn.applyPreferences(autoConnect: preferences.autoConnectMode,
                                   trustedNetworks: preferences.trustedNetworks,
                                   killSwitch: preferences.killSwitch,
                                   accountSuspended: me?.isSuspended == true)
    }
```

- [ ] **Step 4: Вызвать её после обновления на дашборде**

В `vpn_ios/App/Screens/DashboardView.swift` заменить первый блок `.task` на:

```swift
        .task {
            await state.refresh()
            await state.syncProfileWithAccount(vpn: vpn)
            stats = StatsStore.shared?.readSnapshot() ?? .empty
        }
```

- [ ] **Step 5: Прогнать тесты и собрать под устройство**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

```bash
xcodebuild -project vpn_ios/VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -4
```

Ожидается: 61 тест зелёный и `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Коммит**

```bash
git add vpn_ios/App/AppState.swift vpn_ios/App/Screens/DashboardView.swift vpn_ios/Tests/SuspendedAccountTests.swift
git commit -m "fix(ios): при нулевом балансе автоподключение снимается"
```

---

### Task 14: Имя Overlay и проверка на устройстве

Последний штрих плана: приложение начинает называться так, как будет называться в App Store.

**Files:**
- Modify: `vpn_ios/project.yml`, `vpn_ios/project.ui.yml`
- Modify: `docs/DEPLOY.md`

**Interfaces:** нет нового кода.

- [ ] **Step 1: Поменять отображаемое имя**

В `vpn_ios/project.yml` у таргета `VPN404` в `info.properties` заменить строку:

```yaml
        CFBundleDisplayName: Overlay
```

У таргета `VPN404Tunnel` там же:

```yaml
        CFBundleDisplayName: Overlay Tunnel
```

В `vpn_ios/project.ui.yml` у таргета `VPN404` — так же `CFBundleDisplayName: Overlay`.

- [ ] **Step 2: Перегенерировать и собрать**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml
```

```bash
xcodebuild -project vpn_ios/VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -4
```

Ожидается `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Дописать раздел в `docs/DEPLOY.md`**

Добавить в конец файла:

```markdown
## Фаза 7: Overlay — ядро приложения

Приложение переименовано в **Overlay** (bundle ID прежний, `co.404studio.vpn`) и получило вкладки, статистику трафика, правила автоподключения и kill switch. Всё это — ответ на отказ Apple по Guideline 4.3(a); подробности в `docs/superpowers/specs/2026-08-03-ios-overlay-redesign-design.md`.

Бэкенд не меняется — пересобирать сервер не нужно.

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && open VPN404.xcodeproj
```

**Что проверить на устройстве** (симулятор ничего из этого не умеет):

1. В «Настройки → Основные → VPN и управление устройством» профиль называется `Overlay`, а не показывает IP сервера. Старый профиль надо снести: iOS не переписывает уже сохранённую конфигурацию.
2. Настройки → автоподключение «Только Wi-Fi» → выйти из дома в чужую сеть → туннель поднимается сам.
3. Добавить домашнюю сеть в доверенные → дома туннель не поднимается.
4. Kill switch включён → выключить туннель вручную → трафик не идёт, пока правило активно.
5. Обнулить баланс в админке → на дашборде появляется объяснение, автоподключение снимается, интернет остаётся.
6. Пополнить → автоподключение возвращается само.
7. Вкладка «Статистика»: после подключения появляются столбики и запись в истории.
```

- [ ] **Step 4: Прогнать всё**

```bash
xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "Executed|TEST"
```

```bash
cd services/core && npm test 2>&1 | tail -5
```

Ожидается: 61 iOS-тест и 172 бэкенд-теста зелёные.

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/project.yml vpn_ios/project.ui.yml docs/DEPLOY.md
git commit -m "feat(ios): приложение называется Overlay"
```

---

## Что остаётся за пределами этого плана

Два следующих плана составляются после того, как этот отработает:

**План 2 — фильтрующий DNS.** AdGuard Home в Docker на NL-сервере со статическим адресом и выключенным журналом запросов; `dnsFiltered` в ответе `/api/device/tunnel`; `GET /api/device/dns-stats`; настройки `dns_default` и `dns_filtered` в админке; переключатель фильтра в приложении с предупреждением о переподключении.

**План 3 — системные расширения.** App Intents для Siri и автоматизаций, виджет экрана блокировки, `ControlWidget` для Пункта управления (iOS 18+) с запасным вариантом «открыть приложение», если система не даст стартовать туннель из процесса интента.

**Не план, но обязательное:** метаданные App Store, скриншоты, политика конфиденциальности, демо-код в App Review Information и письмо в Resolution Center. Делается после того, как приложение соберётся в финальном виде.
