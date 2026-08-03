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
