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
