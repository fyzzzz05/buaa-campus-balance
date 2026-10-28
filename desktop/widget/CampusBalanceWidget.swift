import AppIntents
import Foundation
import SwiftUI
import WidgetKit

// The container holds display data only. Credentials stay in the app's Keychain.
private let widgetKind = "CampusBalanceWidget"

enum BalanceMetric: String, CaseIterable, Codable {
    case card, network, lighting, air

    var title: String {
        switch self {
        case .card: return "校园卡余额"
        case .network: return "校园网流量余额"
        case .lighting: return "照明电费余额"
        case .air: return "空调电费余额"
        }
    }
    var icon: String {
        switch self {
        case .card: return "creditcard"
        case .network: return "wifi"
        case .lighting: return "lightbulb"
        case .air: return "snowflake"
        }
    }
    var unit: String { self == .network ? "GB" : "元" }
}

struct BalanceValue: Codable {
    let value: Double?
    let note: String?
    let updatedAt: Date?
}

struct BalanceSnapshot: Codable {
    let updatedAt: Date
    let card: BalanceValue
    let network: BalanceValue
    let lighting: BalanceValue
    let air: BalanceValue

    func metric(_ metric: BalanceMetric) -> BalanceValue {
        switch metric {
        case .card: return card
        case .network: return network
        case .lighting: return lighting
        case .air: return air
        }
    }
}

private enum WidgetStorage {
    static var defaults: UserDefaults? { UserDefaults.standard }
    static func selected() -> BalanceMetric {
        BalanceMetric(rawValue: defaults?.string(forKey: "selectedMetric") ?? "") ?? .card
    }
    static func decode(_ data: Data) -> BalanceSnapshot? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: raw) else {
                throw DecodingError.dataCorruptedError(in: try decoder.singleValueContainer(), debugDescription: "Invalid snapshot date")
            }
            return date
        }
        return try? decoder.decode(BalanceSnapshot.self, from: data)
    }
    static func snapshot(_ completion: @escaping (BalanceSnapshot?) -> Void) {
        guard let token = Bundle.main.object(forInfoDictionaryKey: "CampusWidgetToken") as? String,
              let url = URL(string: "http://127.0.0.1:49771/snapshot") else { completion(nil); return }
        var request = URLRequest(url: url, timeoutInterval: 3)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200, let data, data.count <= 4096 else { completion(nil); return }
            completion(decode(data))
        }.resume()
    }
}

struct SelectBalanceIntent: AppIntent {
    static var title: LocalizedStringResource = "切换余额"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "类别") var metric: String

    init() { metric = BalanceMetric.card.rawValue }
    init(metric: BalanceMetric) { self.metric = metric.rawValue }

    func perform() async throws -> some IntentResult {
        guard BalanceMetric(rawValue: metric) != nil, let defaults=WidgetStorage.defaults else { throw WidgetIntentError.storageUnavailable }
        defaults.set(metric, forKey: "selectedMetric")
        guard defaults.synchronize() else { throw WidgetIntentError.storageUnavailable }
        return .result()
    }
}

private enum WidgetIntentError: LocalizedError {
    case storageUnavailable
    var errorDescription: String? { "小组件无法访问共享数据" }
}

struct BalanceEntry: TimelineEntry {
    let date: Date
    let selected: BalanceMetric
    let snapshot: BalanceSnapshot?
}

struct BalanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> BalanceEntry {
        BalanceEntry(date: Date(), selected: .card, snapshot: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (BalanceEntry) -> Void) {
        WidgetStorage.snapshot { snapshot in completion(BalanceEntry(date: Date(), selected: WidgetStorage.selected(), snapshot: snapshot)) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BalanceEntry>) -> Void) {
        WidgetStorage.snapshot { snapshot in
            let now = Date()
            let entry = BalanceEntry(date: now, selected: WidgetStorage.selected(), snapshot: snapshot)
            completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(6 * 60 * 60))))
        }
    }
}

struct BalanceWidgetView: View {
    let entry: BalanceEntry
    @Environment(\.colorScheme) private var colorScheme

    private var metric: BalanceMetric { entry.selected }
    private var balance: BalanceValue? { entry.snapshot?.metric(metric) }
    private var accent: Color { colorScheme == .dark ? Color(red: 76/255, green: 123/255, blue: 1) : Color(red: 47/255, green: 91/255, blue: 234/255) }
    private var ink: Color { colorScheme == .dark ? Color(red: 234/255, green: 239/255, blue: 247/255) : Color(red: 24/255, green: 33/255, blue: 47/255) }
    private var muted: Color { colorScheme == .dark ? Color(red: 151/255, green: 163/255, blue: 184/255) : Color(red: 106/255, green: 117/255, blue: 135/255) }
    private var warningColor: Color { colorScheme == .dark ? Color(red: 240/255, green: 160/255, blue: 112/255) : Color(red: 194/255, green: 96/255, blue: 45/255) }
    private var warning: Bool {
        guard let value = balance?.value else { return false }
        return (metric == .lighting || metric == .air) && value <= 10
    }
    private var subtitle: String {
        guard let snapshot=entry.snapshot else { return "打开 App 更新数据" }
        let updated=balance?.updatedAt ?? snapshot.updatedAt
        if balance?.note == "更新失败" || entry.date.timeIntervalSince(updated)>26*60*60 {
            return "上次更新 " + updated.formatted(.dateTime.month(.defaultDigits).day(.defaultDigits))
        }
        if warning { return "余额偏低" }
        return balance?.note ?? "暂不可用"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(metric.title).font(.system(size: 12, weight: .medium)).foregroundStyle(muted).lineLimit(1).minimumScaleFactor(0.75)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(balance?.value.map { $0.formatted(.number.precision(.fractionLength(metric == .network ? 1 : 2))) } ?? "—")
                    .font(.system(size: 38, weight: .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                    .foregroundStyle(warning ? warningColor : ink).contentTransition(.numericText())
                Text(metric.unit).font(.system(size: 14, weight: .medium)).foregroundStyle(muted)
            }.padding(.top, 6)
            Text(subtitle)
                .font(.system(size: 11)).foregroundStyle(warning ? warningColor : muted).lineLimit(2).padding(.top, 8)
            Spacer(minLength: 4)
            HStack(spacing: 0) {
                ForEach(BalanceMetric.allCases, id: \.self) { item in
                    Button(intent: SelectBalanceIntent(metric: item)) {
                        Image(systemName: item.icon).font(.system(size: 14, weight: .medium))
                            .frame(width: 30, height: 30)
                            .foregroundStyle(item == metric ? (colorScheme == .dark ? Color.black : Color.white) : muted)
                            .background(item == metric ? accent : ink.opacity(0.07), in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel(item.title)
                    if item != BalanceMetric.allCases.last { Spacer(minLength: 0) }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.easeOut(duration: 0.4), value: metric)
        .animation(.easeOut(duration: 0.55), value: balance?.value)
        .containerBackground(for: .widget) { colorScheme == .dark ? Color(red: 30/255, green: 36/255, blue: 50/255).opacity(0.72) : Color.white.opacity(0.78) }
        .widgetURL(URL(string: "campusbalance://dashboard?item=\(metric.rawValue)"))
    }
}

@main struct CampusBalanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: widgetKind, provider: BalanceProvider()) { entry in BalanceWidgetView(entry: entry) }
            .configurationDisplayName("校园余额")
            .description("查看校园卡、校园网和电费余额。")
            .supportedFamilies([.systemSmall])
            .contentMarginsDisabled()
    }
}
