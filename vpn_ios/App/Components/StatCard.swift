import SwiftUI

/// Крупная карточка приборной панели: подпись и содержимое.
struct StatCard<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: label)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// Число моноширинным — как на приборах.
struct StatValue: View {
    let text: String
    var unit: String?
    var size: CGFloat = 32

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(text)
                .font(.system(size: size, weight: .heavy, design: .monospaced))
                .foregroundStyle(Theme.fg)
            if let unit {
                Text(unit)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.muted)
            }
        }
    }
}

/// Половинка ряда из нескольких маленьких карточек.
struct MiniStat: View {
    let label: String
    let value: String
    var tint: Color = Theme.fg

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: label)
            Text(value)
                .font(Theme.mono(12))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
