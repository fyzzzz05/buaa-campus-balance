import Foundation

// Pure parsing routines for the native data adapters. A missing or incomplete
// page throws rather than silently presenting partial spending as complete.
enum CampusHistoryError: Error { case invalid, incomplete }

struct CampusDayValue: Equatable {
    let date: String
    let value: Double?
}

struct CampusRecord: Equatable {
    let label: String
    let date: String
    let value: String
}

enum CardPurpose {
    static func classify(_ merchant: String) -> String {
        if ["浴室", "洗浴", "淋浴"].contains(where: merchant.contains) { return "bath" }
        if ["超市", "便利店"].contains(where: merchant.contains) { return "shop" }
        if ["打印", "复印", "文印"].contains(where: merchant.contains) { return "print" }
        if ["食堂", "餐厅", "餐饮"].contains(where: merchant.contains) { return "food:" + merchant }
        if merchant.contains("车载POS") { return "bus" }
        return "other"
    }
}

struct CampusPurposeDay {
    let date: String
    let categories: [String: Double]
}

struct CampusHistoryResult {
    let history: [CampusDayValue]
    let records: [CampusRecord]
    var purposeHistory: [CampusPurposeDay] = []
}

struct CardTradeAccumulator {
    let days: [String]
    private(set) var totals: [String: Int]
    private(set) var records: [CampusRecord] = []
    private var purposeTotals: [String: [String: Int]] = [:]
    private(set) var received = 0
    private(set) var expected: Int?

    init(days: [String]) {
        self.days = days
        self.totals = Dictionary(uniqueKeysWithValues: days.map { ($0, 0) })
    }

    mutating func appendPage(_ body: [String: Any], pageSize: Int = 100) throws -> Bool {
        guard body["success"] as? Bool == true,
              let data = body["data"] as? [String: Any],
              let rows = data["data"] as? [[String: Any]] else { throw CampusHistoryError.invalid }
        if let raw = data["count"], !(raw is NSNull), let count = Int("\(raw)"), count >= 0,
           !(count == 0 && !rows.isEmpty) { expected = count }
        for row in rows {
            guard let date = row["date"] as? String, date.count >= 10,
                  date.prefix(10).range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                  let raw = row["amount"], !(raw is NSNull), let amount = Int("\(raw)") else { throw CampusHistoryError.invalid }
            let day = String(date.prefix(10))
            if amount < 0, totals[day] != nil {
                guard amount != Int.min, let current = totals[day], current <= Int.max + amount else { throw CampusHistoryError.invalid }
                totals[day] = current - amount
                let label = String(((row["merName"] as? String) ?? (row["txName"] as? String) ?? "校园卡消费").prefix(100))
                let purpose = CardPurpose.classify(label)
                purposeTotals[day, default: [:]][purpose, default: 0] += -amount
                records.append(CampusRecord(label: label, date: date, value: String(format: "¥%.2f", Double(-amount) / 100)))
            }
        }
        received += rows.count
        if let expected {
            if received > expected { throw CampusHistoryError.invalid }
            if received == expected { return true }
            if rows.isEmpty { throw CampusHistoryError.incomplete }
            return false
        }
        return rows.count < pageSize
    }

    func result() -> CampusHistoryResult {
        CampusHistoryResult(history: days.map { CampusDayValue(date: $0, value: Double(totals[$0] ?? 0) / 100) }, records: records,
            purposeHistory: days.map { CampusPurposeDay(date: $0, categories: (purposeTotals[$0] ?? [:]).mapValues { Double($0) / 100 }) })
    }
}

struct NetworkHistoryAccumulator {
    let days: [String]
    private(set) var totals: [String: Double]
    private(set) var records: [CampusRecord] = []
    private(set) var received = 0
    private(set) var expected: Int?

    init(days: [String]) {
        self.days = days
        self.totals = Dictionary(uniqueKeysWithValues: days.map { ($0, 0) })
    }

    mutating func appendPage(total: Int, rows: [(date: String, bytes: Double)]) throws -> Bool {
        guard total >= 0, expected == nil || expected == total else { throw CampusHistoryError.invalid }
        expected = total
        if rows.isEmpty && received < total { throw CampusHistoryError.incomplete }
        for row in rows {
            guard row.date.range(of: #"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"#, options: .regularExpression) != nil,
                  row.bytes.isFinite, row.bytes >= 0 else { throw CampusHistoryError.invalid }
            let gb = row.bytes / 1_073_741_824
            let day = String(row.date.prefix(10))
            if totals[day] != nil { totals[day, default: 0] += gb }
            if records.count < 100 { records.append(CampusRecord(label: "流量结算", date: row.date, value: String(format: "%.2f GB", gb))) }
        }
        received += rows.count
        guard received <= total else { throw CampusHistoryError.invalid }
        return received == total
    }

    func result() -> CampusHistoryResult {
        CampusHistoryResult(history: days.map { CampusDayValue(date: $0, value: totals[$0]) }, records: records)
    }
}
