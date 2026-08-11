import Foundation

/// Адресный префикс в байтах: 4 байта для IPv4, 16 для IPv6.
struct IPPrefix: Equatable {
    let bytes: [UInt8]
    let length: Int
}

/// Считает, какие диапазоны должны идти через туннель: всё, кроме исключённых.
///
/// Обход двоичного дерева по битам адреса, а не арифметика над числами:
/// для IPv6 нужна 128-битная арифметика, которой в Swift под iOS 16 нет,
/// а побитовый обход одинаково работает для обеих версий протокола
/// и сразу даёт минимальный набор диапазонов.
enum RouteCalculator {
    /// Диапазоны для `AllowedIPs`. Мусор во входе отбрасывается молча:
    /// испорченный префикс не должен оставлять человека без маршрутов вообще.
    static func allowedIPs(excluding raw: [String]) -> [String] {
        let excluded = raw.compactMap(parse)
        return (cover(family: 4, excluded: excluded) + cover(family: 16, excluded: excluded))
            .map(format)
    }

    private static func cover(family: Int, excluded: [IPPrefix]) -> [IPPrefix] {
        let ofFamily = excluded.filter { $0.bytes.count == family }
        var result: [IPPrefix] = []
        walk(base: [UInt8](repeating: 0, count: family), length: 0,
             excluded: ofFamily, into: &result)
        return result
    }

    /// Рекурсивно: узел целиком исключён — не отдаём ничего; под узлом нет
    /// исключений — отдаём его целиком; иначе делим пополам и спускаемся.
    private static func walk(base: [UInt8], length: Int,
                             excluded: [IPPrefix], into result: inout [IPPrefix]) {
        let node = IPPrefix(bytes: base, length: length)

        if excluded.contains(where: { covers($0, node) }) { return }

        let inside = excluded.filter { covers(node, $0) }
        if inside.isEmpty {
            result.append(node)
            return
        }

        // сюда не попасть: под узлом максимальной длины исключений быть уже не может
        guard length < base.count * 8 else { return }

        for bit in [UInt8(0), UInt8(1)] {
            var child = base
            let byte = length >> 3
            let mask = UInt8(0x80) >> (length & 7)
            if bit == 1 { child[byte] |= mask } else { child[byte] &= ~mask }
            walk(base: child, length: length + 1, excluded: inside, into: &result)
        }
    }

    /// Первые `outer.length` бит совпадают? Разные версии протокола не сравниваются.
    static func covers(_ outer: IPPrefix, _ inner: IPPrefix) -> Bool {
        guard outer.bytes.count == inner.bytes.count, outer.length <= inner.length else { return false }
        for bit in 0..<outer.length {
            let byte = bit >> 3
            let mask = UInt8(0x80) >> (bit & 7)
            if (outer.bytes[byte] & mask) != (inner.bytes[byte] & mask) { return false }
        }
        return true
    }

    static func parse(_ raw: String) -> IPPrefix? {
        let parts = raw.trimmingCharacters(in: .whitespaces).split(separator: "/")
        guard parts.count == 2, let length = Int(parts[1]), length >= 0 else { return nil }

        let address = String(parts[0])
        guard let bytes = address.contains(":") ? parseIPv6(address) : parseIPv4(address),
              length <= bytes.count * 8
        else { return nil }

        // обнуляем всё за границей префикса, чтобы одинаковые сети совпадали
        var masked = bytes
        if length < bytes.count * 8 {
            for bit in length..<(bytes.count * 8) {
                masked[bit >> 3] &= ~(UInt8(0x80) >> (bit & 7))
            }
        }
        return IPPrefix(bytes: masked, length: length)
    }

    private static func parseIPv4(_ address: String) -> [UInt8]? {
        let parts = address.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var bytes: [UInt8] = []
        for part in parts {
            guard part.count <= 3, let n = UInt16(part), n <= 255 else { return nil }
            bytes.append(UInt8(n))
        }
        return bytes
    }

    private static func parseIPv6(_ address: String) -> [UInt8]? {
        let halves = address.components(separatedBy: "::")
        guard halves.count <= 2 else { return nil }

        func groups(_ s: String) -> [UInt16]? {
            if s.isEmpty { return [] }
            var out: [UInt16] = []
            for g in s.split(separator: ":", omittingEmptySubsequences: false) {
                guard g.count >= 1, g.count <= 4, let n = UInt16(g, radix: 16) else { return nil }
                out.append(n)
            }
            return out
        }

        guard let head = groups(halves[0]),
              let tail = halves.count == 2 ? groups(halves[1]) : []
        else { return nil }

        let missing = 8 - head.count - tail.count
        if halves.count == 1 ? missing != 0 : missing < 0 { return nil }

        let all = head + [UInt16](repeating: 0, count: missing) + tail
        return all.flatMap { [UInt8($0 >> 8), UInt8($0 & 0xff)] }
    }

    static func format(_ prefix: IPPrefix) -> String {
        if prefix.bytes.count == 4 {
            return prefix.bytes.map(String.init).joined(separator: ".") + "/\(prefix.length)"
        }

        var groups: [String] = []
        for i in stride(from: 0, to: 16, by: 2) {
            groups.append(String((UInt16(prefix.bytes[i]) << 8) | UInt16(prefix.bytes[i + 1]), radix: 16))
        }

        // сворачиваем самую длинную цепочку нулевых групп в «::»
        var bestStart = -1, bestLength = 0, start = -1
        for i in 0...groups.count {
            if i < groups.count && groups[i] == "0" {
                if start == -1 { start = i }
            } else if start != -1 {
                if i - start > bestLength { bestLength = i - start; bestStart = start }
                start = -1
            }
        }

        let address: String
        if bestLength > 1 {
            let head = groups[0..<bestStart].joined(separator: ":")
            let tail = groups[(bestStart + bestLength)...].joined(separator: ":")
            address = "\(head)::\(tail)"
        } else {
            address = groups.joined(separator: ":")
        }
        return "\(address)/\(prefix.length)"
    }
}
