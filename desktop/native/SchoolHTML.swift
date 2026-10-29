import Foundation

struct NetworkQuota: Equatable {
    let free: Double
    let paid: Double
    let used: Double
}

struct SchoolLoginForm {
    let action: URL
    let fields: [String: String]
}

enum SchoolHTML {
    private static func document(_ html: String) throws -> XMLDocument {
        guard html.utf8.count <= 3_000_000 else { throw CampusHistoryError.invalid }
        return try XMLDocument(xmlString: html, options: [.documentTidyHTML])
    }

    static func loginForm(_ html: String, at base: URL) throws -> SchoolLoginForm {
        guard SchoolRedirectPolicy.allowed(base), base.host?.lowercased() == "sso.buaa.edu.cn" else { throw CampusHistoryError.invalid }
        let document = try document(html)
        guard let form = try document.nodes(forXPath: "//form[@id='loginForm']").first as? XMLElement else { throw CampusHistoryError.invalid }
        var fields: [String: String] = [:]
        for case let input as XMLElement in try form.nodes(forXPath: ".//input[@name]") {
            guard let name = input.attribute(forName: "name")?.stringValue, ["execution", "_eventId", "type"].contains(name) else { continue }
            fields[name] = input.attribute(forName: "value")?.stringValue ?? ""
        }
        guard fields["execution"] != nil, let action = URL(string: form.attribute(forName: "action")?.stringValue ?? "", relativeTo: base)?.absoluteURL,
              SchoolRedirectPolicy.allowed(action), action.host?.lowercased() == "sso.buaa.edu.cn" else { throw CampusHistoryError.invalid }
        return SchoolLoginForm(action: action, fields: fields)
    }

    private static func quotaValue(_ raw: String) -> Double? {
        let pattern = #"^\s*(\d+(?:\.\d+)?)\s*(G|GB|M|MB|K|KB|T|TB)\s*$"#
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = expression.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
              let numberRange = Range(match.range(at: 1), in: raw), let unitRange = Range(match.range(at: 2), in: raw),
              let number = Double(raw[numberRange]), number.isFinite else { return nil }
        let multiplier: Double
        switch raw[unitRange].lowercased().first {
        case "g": multiplier = 1
        case "m": multiplier = 1 / 1024
        case "k": multiplier = 1 / (1024 * 1024)
        case "t": multiplier = 1024
        default: return nil
        }
        return number * multiplier
    }

    static func quota(_ html: String) throws -> NetworkQuota {
        let document = try document(html)
        for case let table as XMLElement in try document.nodes(forXPath: "//table") {
            let rows = try table.nodes(forXPath: ".//tr")
            for index in rows.indices {
                let columns = try rows[index].nodes(forXPath: "./th|./td").map { ($0.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
                guard let freeIndex = columns.firstIndex(where: { $0.contains("免费流量剩余") }),
                      let paidIndex = columns.firstIndex(where: { $0.contains("计费流量剩余") }),
                      let usedIndex = columns.firstIndex(where: { $0.contains("已用流量") }), index + 1 < rows.count else { continue }
                let values = try rows[index + 1].nodes(forXPath: "./th|./td").map { $0.stringValue ?? "" }
                guard max(freeIndex, paidIndex, usedIndex) < values.count,
                      let free = quotaValue(values[freeIndex]), let paid = quotaValue(values[paidIndex]), let used = quotaValue(values[usedIndex]) else { continue }
                return NetworkQuota(free: free, paid: paid, used: used)
            }
        }
        throw CampusHistoryError.invalid
    }
    static func networkPage(_ html: String) throws -> (total: Int, rows: [(date: String, bytes: Double)]) {
        let doc = try document(html)
        guard let summary = try doc.nodes(forXPath: "//*[contains(concat(' ',normalize-space(@class),' '),' summary ')]").first?.stringValue,
              let match = summary.range(of: #"共\s*[0-9,]+\s*条"#, options: .regularExpression),
              let digits = summary[match].range(of: #"[0-9,]+"#, options: .regularExpression),
              let total = Int(summary[digits].replacingOccurrences(of: ",", with: "")),
              (try doc.nodes(forXPath: "//table")).contains(where: { ($0.stringValue ?? "").contains("总流量") }) else { throw CampusHistoryError.invalid }
        var rows: [(date: String, bytes: Double)] = []
        for row in try doc.nodes(forXPath: "//table//tbody/tr") {
            let columns = try row.nodes(forXPath: "./td").map { ($0.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
            guard columns.count >= 6, let bytes = Double(columns[4].replacingOccurrences(of: ",", with: "")),
                  columns[1].range(of: #"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"#, options: .regularExpression) != nil else { continue }
            rows.append((date: columns[1], bytes: bytes))
        }
        return (total, rows)
    }

}
