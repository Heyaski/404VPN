import Foundation

struct TunnelPeer: Codable, Equatable {
    let publicKey: String
    let presharedKey: String?
    let endpoint: String
    let allowedIps: [String]
    let persistentKeepalive: Int?
}

struct TunnelConfig: Equatable {
    let privateKey: String
    let address: String
    /// Обычные резолверы.
    let dns: [String]
    /// Резолверы с фильтром рекламы. Пусто — фильтр на сервере не настроен.
    let dnsFiltered: [String]
    let peer: TunnelPeer

    var isFilterAvailable: Bool { !dnsFiltered.isEmpty }

    /// Текст в формате wg-quick — именно его понимает WireGuardKit.
    /// Фильтр никогда не мешает подключению: если он не настроен на сервере,
    /// молча берём обычные резолверы.
    func wgQuick(filtered: Bool) -> String {
        let resolvers = filtered && isFilterAvailable ? dnsFiltered : dns

        var lines = ["[Interface]", "PrivateKey = \(privateKey)", "Address = \(address)"]
        if !resolvers.isEmpty { lines.append("DNS = \(resolvers.joined(separator: ", "))") }
        lines.append("")
        lines.append("[Peer]")
        lines.append("PublicKey = \(peer.publicKey)")
        if let psk = peer.presharedKey, !psk.isEmpty { lines.append("PresharedKey = \(psk)") }
        lines.append("AllowedIPs = \(peer.allowedIps.joined(separator: ", "))")
        lines.append("Endpoint = \(peer.endpoint)")
        if let keepalive = peer.persistentKeepalive {
            lines.append("PersistentKeepalive = \(keepalive)")
        }
        return lines.joined(separator: "\n")
    }
}

/// Разбор вынесен в расширение, чтобы у структуры остался обычный инициализатор:
/// он нужен тестам. Поле dnsFiltered необязательное — сервер мог быть не обновлён.
extension TunnelConfig: Codable {
    enum CodingKeys: String, CodingKey {
        case privateKey, address, dns, dnsFiltered, peer
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        privateKey = try c.decode(String.self, forKey: .privateKey)
        address = try c.decode(String.self, forKey: .address)
        dns = try c.decode([String].self, forKey: .dns)
        dnsFiltered = try c.decodeIfPresent([String].self, forKey: .dnsFiltered) ?? []
        peer = try c.decode(TunnelPeer.self, forKey: .peer)
    }
}

struct RedeemResponse: Decodable {
    let token: String
    let balance: String
    let daysLeft: Int?
}

struct MeResponse: Decodable {
    let balance: String
    let status: String
    let devices: Int
    let deviceName: String?
    let daysLeft: Int?

    var isSuspended: Bool { status != "active" }
}

enum ApiError: LocalizedError, Equatable {
    case invalidCode
    case alreadyUsed
    case expired
    case revoked
    case tooManyAttempts
    case suspended
    case blocked
    case unauthorized
    case tunnelUnavailable
    case network(String)

    /// Разбирает поле `error` из ответа бэкенда.
    static func from(code: String, status: Int) -> ApiError {
        switch code {
        case "invalid_code": return .invalidCode
        case "already_used": return .alreadyUsed
        case "expired": return .expired
        case "revoked": return .revoked
        case "too_many_attempts": return .tooManyAttempts
        case "suspended": return .suspended
        case "blocked": return .blocked
        case "unauthorized": return .unauthorized
        case "wg_unavailable": return .tunnelUnavailable
        default: return .network("Ошибка сервера (\(status))")
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidCode: return "Такого кода не существует. Проверь символы."
        case .alreadyUsed: return "Этот код уже активирован."
        case .expired: return "Срок действия кода истёк."
        case .revoked: return "Код отозван."
        case .tooManyAttempts: return "Слишком много попыток. Подожди минуту."
        case .suspended: return "Баланс закончился — пополни, чтобы подключиться."
        case .blocked: return "Доступ заблокирован."
        case .unauthorized: return "Устройство больше не привязано. Введи код заново."
        case .tunnelUnavailable: return "Сервер сейчас не выдаёт подключения. Попробуй позже."
        case let .network(message): return message
        }
    }
}

/// Клиент API бэкенда. Базовый адрес берётся из Info.plist (ключ APIBaseURL).
struct Api {
    let baseURL: URL
    var tokenProvider: () -> String?

    init(baseURL: URL? = nil, tokenProvider: @escaping () -> String? = { Keychain.token() }) {
        let fromPlist = (Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String)
            .flatMap(URL.init(string:))
        self.baseURL = baseURL ?? fromPlist ?? URL(string: "https://404studiotech-miniapp.ru")!
        self.tokenProvider = tokenProvider
    }

    func redeem(code: String, deviceName: String) async throws -> RedeemResponse {
        try await send(
            path: "/api/redeem",
            body: ["code": code, "deviceName": deviceName],
            authorized: false
        )
    }

    func me() async throws -> MeResponse {
        try await send(path: "/api/device/me", method: "GET")
    }

    func tunnel() async throws -> TunnelConfig {
        try await send(path: "/api/device/tunnel")
    }

    func revokeDevice() async throws {
        let _: EmptyResponse = try await send(path: "/api/device", method: "DELETE")
    }

    private struct EmptyResponse: Decodable {}
    private struct ErrorBody: Decodable { let error: String }

    private func send<T: Decodable>(
        path: String,
        method: String = "POST",
        body: [String: String]? = nil,
        authorized: Bool = true
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized, let token = tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ApiError.network("Нет связи с сервером")
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let code = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? ""
            throw ApiError.from(code: code, status: status)
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiError.network("Неожиданный ответ сервера")
        }
    }
}

/// Приводит введённый код к виду XXXX-XXXX-XXXX-XXXX: верхний регистр,
/// только буквы и цифры, дефисы расставляются сами.
enum CodeFormatter {
    static let maxLength = 16

    static func format(_ raw: String) -> String {
        let cleaned = raw.uppercased().filter { $0.isLetter || $0.isNumber }
        let trimmed = String(cleaned.prefix(maxLength))
        return stride(from: 0, to: trimmed.count, by: 4)
            .map { offset -> String in
                let start = trimmed.index(trimmed.startIndex, offsetBy: offset)
                let end = trimmed.index(start, offsetBy: min(4, trimmed.count - offset))
                return String(trimmed[start..<end])
            }
            .joined(separator: "-")
    }

    static func isComplete(_ formatted: String) -> Bool {
        formatted.filter { $0.isLetter || $0.isNumber }.count == maxLength
    }
}
