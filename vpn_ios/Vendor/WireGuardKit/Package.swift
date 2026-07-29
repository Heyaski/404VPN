// swift-tools-version:5.9
// Локальная копия WireGuardKit (github.com/WireGuard/wireguard-apple, тег 1.0.15-26).
// Отличия от upstream, необходимые для сборки на Xcode 26:
//   1. tools-version и платформы подняты — манифест 5.3 с .iOS(.v12) больше не принимается;
//   2. в Sources/WireGuardKitC/WireGuardKitC.h добавлен #include <sys/types.h> —
//      без него режим явных модулей падает на u_int32_t/u_char.
// Библиотека libwg-go собирается Makefile'ом из Sources/WireGuardKitGo — за это
// отвечает build-фаза таргета туннеля (см. vpn_ios/project.yml).

import PackageDescription

let package = Package(
    name: "WireGuardKit",
    platforms: [
        .macOS(.v11),
        .iOS(.v16),
    ],
    products: [
        .library(name: "WireGuardKit", targets: ["WireGuardKit"])
    ],
    dependencies: [],
    targets: [
        .target(
            name: "WireGuardKit",
            dependencies: ["WireGuardKitGo", "WireGuardKitC"]
        ),
        .target(
            name: "WireGuardKitC",
            dependencies: [],
            publicHeadersPath: "."
        ),
        .target(
            name: "WireGuardKitGo",
            dependencies: [],
            exclude: [
                "goruntime-boottime-over-monotonic.diff",
                "go.mod",
                "go.sum",
                "api-apple.go",
                "Makefile",
            ],
            publicHeadersPath: ".",
            linkerSettings: [.linkedLibrary("wg-go")]
        ),
    ]
)
