import Charts
import SwiftUI

/// Столбчатый график трафика по дням. Swift Charts есть с iOS 16 — сторонних зависимостей не нужно.
struct TrafficChart: View {
    let days: [DailyTraffic]

    var body: some View {
        Chart(days) { day in
            BarMark(
                x: .value("День", day.day, unit: .day),
                y: .value("Трафик", Double(day.totalBytes) / 1_048_576)
            )
            .foregroundStyle(Theme.accent.opacity(0.85))
            .cornerRadius(2)
        }
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(Theme.border)
                AxisValueLabel {
                    if let megabytes = value.as(Double.self) {
                        Text("\(Int(megabytes)) МБ")
                            .font(Theme.mono(9))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day)) { _ in
                AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                    .font(Theme.mono(9))
                    .foregroundStyle(Theme.muted)
            }
        }
    }
}
