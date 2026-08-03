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
