import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    @Published var hasToken: Bool = Keychain.token() != nil
    @Published var me: MeResponse?
    @Published var errorMessage: String?
    @Published var isBusy = false

    let api = Api()

    init() {
        #if DEBUG
        // Позволяет снимать главный экран в симуляторе без активации кода:
        // SIMCTL_CHILD_UI_PREVIEW_HOME=1 xcrun simctl launch <device> <bundle>
        if ProcessInfo.processInfo.environment["UI_PREVIEW_HOME"] == "1" {
            hasToken = true
            me = MeResponse(balance: "300.00", status: "active", devices: 1,
                            deviceName: "iPhone", daysLeft: 90)
        }
        #endif
    }

    func redeem(code: String) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response = try await api.redeem(code: code, deviceName: UIDevice.current.name)
            Keychain.saveToken(response.token)
            hasToken = true
            await refresh()
        } catch {
            errorMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
    }

    func refresh() async {
        guard hasToken else { return }
        do {
            me = try await api.me()
            errorMessage = nil
        } catch {
            handle(error)
        }
    }

    /// Единая обработка ошибок: недействительный токен всегда возвращает к вводу кода.
    /// Устройство может быть отвязано откуда угодно — из бота, из админки, удалением
    /// аккаунта, — и приложение не должно застревать на экране, в который уже не попасть.
    private func handle(_ error: Error) {
        if case ApiError.unauthorized = error {
            signOut()
            errorMessage = ApiError.unauthorized.errorDescription
            return
        }
        errorMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
    }

    /// Забирает конфигурацию туннеля и ставит её в системный профиль.
    func installTunnel(into vpn: VPNManager) async -> Bool {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let config = try await api.tunnel()
            try await vpn.install(config: config)
            return true
        } catch {
            handle(error)
            return false
        }
    }

    /// Отвязывает устройство: освобождает слот и останавливает суточное списание.
    /// Локальное состояние чистим в любом случае — если аккаунт уже удалён на сервере,
    /// запрос вернёт 401, но на устройстве всё равно нужно вернуться к вводу кода.
    func unlinkDevice(from vpn: VPNManager) async {
        isBusy = true
        defer { isBusy = false }
        try? await api.revokeDevice()
        await vpn.removeProfile()
        signOut()
        errorMessage = nil
    }

    func signOut() {
        Keychain.clear()
        hasToken = false
        me = nil
    }
}
