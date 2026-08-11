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

    /// Последний известный баланс — чтобы виджет показывал его без похода в сеть.
    var lastBalance: String? {
        get { defaults.string(forKey: Key.balance) }
        nonmutating set { defaults.set(newValue, forKey: Key.balance) }
    }

    /// Включён ли фильтр рекламы и трекеров.
    var dnsFilter: Bool {
        get { defaults.bool(forKey: Key.dnsFilter) }
        nonmutating set { defaults.set(newValue, forKey: Key.dnsFilter) }
    }

    /// Настроен ли фильтр на сервере. Запоминается при получении конфигурации,
    /// чтобы экран настроек знал о доступности ещё до первого подключения
    /// после запуска приложения.
    var dnsFilterAvailable: Bool {
        get { defaults.bool(forKey: Key.dnsFilterAvailable) }
        nonmutating set { defaults.set(newValue, forKey: Key.dnsFilterAvailable) }
    }

    private enum Key {
        static let autoConnect = "autoConnectMode"
        static let trusted = "trustedNetworks"
        static let balance = "lastBalance"
        static let dnsFilter = "dnsFilter"
        static let dnsFilterAvailable = "dnsFilterAvailable"
    }
}
