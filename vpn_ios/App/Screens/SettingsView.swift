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
    @State private var dnsFilter: Bool = Preferences.shared.dnsFilter
    @State private var switchingFilter = false

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

    /// Обычные строки с галочкой вместо стокового пикера: `.inline` вне `List`
    /// рендерится колесом и съедает пол-экрана, а `.segmented` не вмещает названия.
    private var autoConnectSection: some View {
        StatCard(label: "автоподключение") {
            VStack(spacing: 0) {
                ForEach(AutoConnectMode.allCases, id: \.self) { option in
                    Button {
                        mode = option
                        persist()
                    } label: {
                        HStack {
                            Text(option.title)
                                .font(.system(size: 14))
                                .foregroundStyle(mode == option ? Theme.fg : Theme.fgSoft)
                            Spacer()
                            if mode == option {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                        .contentShape(Rectangle())
                        .padding(.vertical, 11)
                    }
                    .buttonStyle(.plain)
                    if option != AutoConnectMode.allCases.last {
                        Divider().overlay(Theme.border)
                    }
                }
            }

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

            Divider().overlay(Theme.border).padding(.vertical, 4)

            Toggle("Блокировать рекламу и трекеры", isOn: $dnsFilter)
                .font(.system(size: 14))
                .tint(Theme.accent)
                .disabled(!Preferences.shared.dnsFilterAvailable || switchingFilter)
                .onChange(of: dnsFilter) { _ in Task { await applyDnsFilter() } }

            if Preferences.shared.dnsFilterAvailable {
                Text(switchingFilter
                     ? "Переподключаем туннель…"
                     : "Реклама и трекеры отсекаются на уровне DNS. Переключение меняет настройки соединения, поэтому туннель на пару секунд переподключится.")
                    .font(.system(size: 12))
                    .foregroundStyle(switchingFilter ? Theme.accent : Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Фильтр пока не настроен на сервере.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var deviceSection: some View {
        StatCard(label: "устройство") {
            if let me = state.me {
                Text(me.deviceName ?? "это устройство")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.fg)
                Text("баланс \(TrafficFormatter.money(me.balance)) ₽")
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

    /// Фильтр меняет адреса DNS, а они входят в конфигурацию WireGuard —
    /// значит профиль надо переустановить, а поднятый туннель переподключить.
    private func applyDnsFilter() async {
        Preferences.shared.dnsFilter = dnsFilter
        guard vpn.status == .connected else { return }
        switchingFilter = true
        defer { switchingFilter = false }
        vpn.disconnect()
        guard await state.installTunnel(into: vpn) else { return }
        try? vpn.connect()
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
