import SwiftUI

@main
struct VPN404App: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            Group {
                if state.hasToken {
                    HomeView()
                } else {
                    RedeemView()
                }
            }
            .environmentObject(state)
        }
    }
}
