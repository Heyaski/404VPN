import SwiftUI

/// Токены дизайн-системы 404 Studiotech — см. docs/DESIGN.md.
enum Theme {
    static let bg = Color(hex: 0x070B14)
    static let bgSoft = Color(hex: 0x0B1120)
    static let surface = Color(hex: 0x0F1626)
    static let surface2 = Color(hex: 0x141D31)
    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.15)
    static let fg = Color(hex: 0xF3F6FC)
    static let fgSoft = Color(hex: 0xC3CCDB)
    static let muted = Color(hex: 0x8593A8)
    static let accent = Color(hex: 0x34D399)
    static let accentStrong = Color(hex: 0x10B981)
    static let accentContrast = Color(hex: 0x04150D)
    static let accentSoft = Color(hex: 0x34D399).opacity(0.12)
    static let accentGlow = Color(hex: 0x34D399).opacity(0.28)
    static let warn = Color(hex: 0xF59E0B)
    static let danger = Color(hex: 0xEF4444)
    static let gridLine = Color.white.opacity(0.035)

    static let radius: CGFloat = 8

    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Фон приложения: базовый цвет плюс едва заметная инженерная сетка.
struct GridBackground: View {
    var body: some View {
        ZStack {
            Theme.bg
            Canvas { context, size in
                let step: CGFloat = 32
                var path = Path()
                var x: CGFloat = 0
                while x <= size.width {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: size.height))
                    x += step
                }
                var y: CGFloat = 0
                while y <= size.height {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                    y += step
                }
                context.stroke(path, with: .color(Theme.gridLine), lineWidth: 1)
            }
        }
        .ignoresSafeArea()
    }
}

/// Технический подзаголовок капсом с разрядкой — фирменный приём студии.
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.muted

    var body: some View {
        Text(text.uppercased())
            .font(Theme.mono(11))
            .tracking(2)
            .foregroundStyle(color)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.accentContrast)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .fill(configuration.isPressed ? Theme.accentStrong : Theme.accent)
            )
            .shadow(color: enabled ? Theme.accentGlow : .clear, radius: 18, y: 6)
            .opacity(enabled ? 1 : 0.45)
    }
}

struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .fill(Theme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radius)
                            .strokeBorder(Theme.border, lineWidth: 1)
                    )
            )
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}
