import SwiftUI

@main
struct VPN404App: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            if state.hasToken {
                RootView().environmentObject(state)
            } else {
                RedeemView().environmentObject(state)
            }
        }
    }
}
