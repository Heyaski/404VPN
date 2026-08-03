import SwiftUI

/// Статистика: график по дням, итоги за период, история подключений.
struct StatsView: View {
    @State private var period: StatsPeriod = .week
    @State private var sessions: [SessionRecord] = []

    private var visible: [SessionRecord] { StatsAggregator.sessions(sessions, in: period) }
    private var days: [DailyTraffic] { StatsAggregator.byDay(visible) }
    private var newestFirst: [SessionRecord] { visible.sorted { $0.startedAt > $1.startedAt } }

    var body: some View {
        ZStack {
            GridBackground()
            ScrollView {
                VStack(spacing: 12) {
                    picker
                    if visible.isEmpty {
                        emptyState
                    } else {
                        chart
                        totals
                        history
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .task { sessions = StatsStore.shared?.readSessions() ?? [] }
    }

    private var picker: some View {
        Picker("Период", selection: $period) {
            ForEach(StatsPeriod.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .padding(.top, 12)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("Пока нечего показать")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.fg)
            Text("Данные появятся после первого подключения: приложение считает трафик само, на устройстве.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .card()
    }

    private var chart: some View {
        StatCard(label: "трафик по дням") {
            TrafficChart(days: days).frame(height: 150)
        }
    }

    private var totals: some View {
        HStack(spacing: 10) {
            MiniStat(label: "принято",
                     value: TrafficFormatter.bytes(visible.reduce(0) { $0 + $1.rxBytes }))
            MiniStat(label: "отдано",
                     value: TrafficFormatter.bytes(visible.reduce(0) { $0 + $1.txBytes }))
            MiniStat(label: "под защитой",
                     value: TrafficFormatter.duration(visible.reduce(0) { $0 + $1.duration() }))
        }
    }

    private var history: some View {
        StatCard(label: "подключения") {
            VStack(spacing: 0) {
                ForEach(newestFirst) { session in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.startedAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.fg)
                            Text(TrafficFormatter.duration(session.duration()))
                                .font(Theme.mono(10))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Text(TrafficFormatter.bytes(session.totalBytes))
                            .font(Theme.mono(12))
                            .foregroundStyle(Theme.fgSoft)
                    }
                    .padding(.vertical, 9)
                    if session.id != newestFirst.last?.id {
                        Divider().overlay(Theme.border)
                    }
                }
            }
        }
    }
}
