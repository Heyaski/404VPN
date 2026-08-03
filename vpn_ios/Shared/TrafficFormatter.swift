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

    /// Бэкенд отдаёт баланс строкой вида «300.00». В русском интерфейсе разделитель — запятая.
    static func money(_ raw: String) -> String {
        raw.replacingOccurrences(of: ".", with: ",")
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(max(0, seconds))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        return hours > 0 ? "\(hours) ч \(minutes) мин" : "\(minutes) мин"
    }
}
