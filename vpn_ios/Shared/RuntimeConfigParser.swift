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
