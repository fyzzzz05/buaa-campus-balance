import Foundation

struct ElectricityConfig {
    let lighting: String
    let air: String
    let historyOwner: String
}
struct ElectricityReading {
    let value: Double
    var note: String
    let history: [CampusDayValue]
    var transportDiagnostic: [String:Any]? = nil
}

enum Electricity {
    // RFC 4180 quoting; preserve empty columns and ignore trailing empty rows.
    static func csv(_ text: String) throws -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], cell = "", quoted = false, afterQuote = false
        let chars = Array(text.trimmingCharacters(in: CharacterSet(charactersIn: "\u{feff}")))
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" { cell.append("\""); i += 1 }
                    else { quoted = false; afterQuote = true }
                } else { cell.append(c) }
            } else if c == "," { row.append(cell); cell = ""; afterQuote = false }
            else if c == "\n" || c == "\r" || c == "\r\n" {
                if c == "\r" && i + 1 < chars.count && chars[i + 1] == "\n" { i += 1 }
                row.append(cell); if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
                row = []; cell = ""; afterQuote = false
            } else if c == "\"" && cell.isEmpty && !afterQuote { quoted = true }
            else if afterQuote { throw CampusHistoryError.invalid }
            else { cell.append(c) }
            i += 1
        }
        guard !quoted else { throw CampusHistoryError.invalid }
        row.append(cell); if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
        return rows
    }

    static func history(_ text: String, config: ElectricityConfig) throws -> [String: ElectricityReading] {
        guard text.utf8.count <= 2_000_000 else { throw CampusHistoryError.invalid }
        let rows = try csv(text)
        guard let header = rows.first else { return [:] }
        func index(_ name: String) throws -> Int { guard let i = header.firstIndex(of: name) else { throw CampusHistoryError.invalid }; return i }
        let dateIndex = try index("date"), keyIndex = try index("key"), meterIndex = try index("meter_id"), valueIndex = try index("remaining_cny")
        var values: [String: [String: Double]] = [:]
        for row in rows.dropFirst() {
            guard row.count > max(dateIndex,keyIndex,meterIndex,valueIndex),
                  row[dateIndex].range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { continue }
            let key = row[keyIndex], meter = key == "lighting" ? config.lighting : key == "air_conditioner" ? config.air : ""
            guard !meter.isEmpty, row[meterIndex] == meter, let amount = Double(row[valueIndex]), amount.isFinite, amount >= 0 else { continue }
            values[key, default: [:]][row[dateIndex]] = amount
        }
        var result: [String: ElectricityReading] = [:]
        for (key, entries) in values {
            guard let latest = entries.keys.sorted().last, let value = entries[latest] else { continue }
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")!; formatter.dateFormat = "yyyy-MM-dd"
            guard let latestDate = formatter.date(from: latest) else { continue }
            let days = NativeSchoolClient.recentDays(count: 15, now: latestDate.addingTimeInterval(12 * 3600))
            let history = (1..<days.count).map { i -> CampusDayValue in
                let before = entries[days[i - 1]], after = entries[days[i]]
                let difference = before.flatMap { b in after.flatMap { a in b >= a ? ((b - a) * 100).rounded() / 100 : nil } }
                return CampusDayValue(date: days[i], value: difference)
            }
            result[key == "air_conditioner" ? "air" : key] = ElectricityReading(value: value, note: "截至 " + latest, history: history)
        }
        return result
    }
    static func meter(_ html: String, id: String, kind: String) throws -> ElectricityReading {
        guard id.range(of: #"^\d{1,30}$"#, options: .regularExpression) != nil, ["air", "lighting"].contains(kind), html.utf8.count <= 2_000_000 else { throw CampusHistoryError.invalid }
        let doc = try XMLDocument(xmlString: html, options: [.documentTidyHTML])
        let paragraphs = try doc.nodes(forXPath: "//p").map { ($0.stringValue ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines) }
        func field(_ prefix: String) -> String {
            let aliases = ["地址:":["地址:","地哈哈址:"], "电价:":["电价:","电哈哈价:"]][prefix] ?? [prefix]
            for label in aliases {
                if let value = paragraphs.first(where: { $0.hasPrefix(label) }) { return String(value.dropFirst(label.count)).trimmingCharacters(in:.whitespaces) }
            }
            return ""
        }
        func number(_ value: String) -> Double? {
            guard let range = value.range(of: #"[-+]?\d+(?:\.\d+)?"#, options: .regularExpression) else { return nil }
            return Double(value[range])
        }
        let pattern = #"(?is)<svg\b[^>]*\bid\s*=\s*['\"]canvas1['\"][^>]*>(.*?)</svg\s*>"#
        let svgExpression = try NSRegularExpression(pattern: pattern)
        let fullRange = NSRange(html.startIndex..., in: html)
        guard let svg = svgExpression.firstMatch(in: html, range: fullRange), let svgRange = Range(svg.range(at: 1), in: html) else { throw CampusIssue(code:.fieldMissing,field:.quantity) }
        let svgText = String(html[svgRange])
        let spanExpression = try NSRegularExpression(pattern: #"(?is)<tspan\b[^>]*>(.*?)</tspan\s*>"#)
        guard let span = spanExpression.matches(in: svgText, range: NSRange(svgText.startIndex..., in: svgText)).last,
              let spanRange = Range(span.range(at: 1), in: svgText) else { throw CampusIssue(code:.fieldMissing,field:.quantity) }
        let quantityText = String(svgText[spanRange])
        guard !field("购电表号:").isEmpty else { throw CampusIssue(code:.fieldMissing,field:.meterID) }
        guard field("购电表号:") == id else { throw CampusIssue(code:.meterIDMismatch) }
        guard !field("地址:").isEmpty else { throw CampusIssue(code:.fieldMissing,field:.address) }
        guard field("地址:").contains(kind == "air" ? "空调" : "照明") else { throw CampusIssue(code:.meterKindMismatch) }
        guard !field("电价:").isEmpty else { throw CampusIssue(code:.fieldMissing,field:.price) }
        guard let price = number(field("电价:")), price.isFinite, price >= 0 else { throw CampusIssue(code:.meterValueInvalid,field:.price) }
        guard let quantity = number(quantityText), quantity.isFinite, quantity >= 0 else { throw CampusIssue(code:.meterValueInvalid,field:.quantity) }
        let note = paragraphs.first(where: { $0.contains("截止") }) ?? "学校电表"
        return ElectricityReading(value: (price * quantity * 100).rounded() / 100, note: note, history: [])
    }

    static func fetchHistory(config: ElectricityConfig) async throws -> [String: ElectricityReading] {
        guard config.historyOwner.range(of: #"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$"#, options: .regularExpression) != nil,
              let url = URL(string: "https://raw.githubusercontent.com/\(config.historyOwner)/buaa-electricity-monitor/main/data/history.csv") else { throw CampusHistoryError.invalid }
        var request = URLRequest(url:url); request.timeoutInterval = 12
        let (data,response) = try await URLSession.shared.data(for:request,delegate:ElectricityRedirectPolicy())
        guard let http = response as? HTTPURLResponse else { throw CampusIssue(code:.invalidResponse) }
        guard http.statusCode == 200 else { throw CampusIssue(code:.http,httpStatus:http.statusCode) }
        guard http.url?.host == "raw.githubusercontent.com", data.count <= 2_000_000,
              let text = String(data:data,encoding:.utf8) else { throw CampusHistoryError.invalid }
        return try history(text,config:config)
    }

    static func fetchMeter(id: String, kind: String, session suppliedSession: URLSession? = nil) async throws -> ElectricityReading {
        guard id.range(of: #"^\d{1,30}$"#, options: .regularExpression) != nil else { throw CampusHistoryError.invalid }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        let session = suppliedSession ?? URLSession(configuration:configuration)
        defer { if suppliedSession == nil { session.invalidateAndCancel() } }
        func read(_ transport: CampusIssue.Transport) async throws -> ElectricityReading {
            do {
                var components = URLComponents(string:transport.rawValue + "://shsd.buaa.edu.cn/PubBuaa")!
                components.queryItems = [URLQueryItem(name:"id",value:id)]
                var request = URLRequest(url:components.url!); request.timeoutInterval = 7
                let (data,response) = try await session.data(for:request,delegate:ElectricityRedirectPolicy())
                guard let http = response as? HTTPURLResponse else { throw CampusIssue(code:.invalidResponse) }
                guard !(300...399).contains(http.statusCode) else { throw CampusIssue(code:.redirect) }
                guard http.statusCode == 200 else { throw CampusIssue(code:.http,httpStatus:http.statusCode) }
                guard http.url?.host == "shsd.buaa.edu.cn", http.url?.scheme == transport.rawValue else { throw CampusIssue(code:.redirect) }
                guard data.count <= 2_000_000 else { throw CampusIssue(code:.responseTooLarge) }
                guard let text = String(data:data,encoding:.utf8) else { throw CampusIssue(code:.invalidResponse) }
                return try meter(text,id:id,kind:kind)
            } catch {
                var issue = CampusDiagnostics.contextualize(error,url:URL(string:"https://shsd.buaa.edu.cn/PubBuaa")!)
                issue.transport = transport
                throw issue
            }
        }
        do { return try await read(.https) }
        catch {
            let issue = CampusDiagnostics.issue(error)
            guard issue.code == .connection || issue.code == .timeout else { throw error }
            let diagnostic = CampusDiagnostics.report(error,stage:kind == "air" ? .airMeter : .lightingMeter)
            var reading = try await read(.http)
            reading.note += " · HTTP 查询"
            reading.transportDiagnostic = diagnostic
            return reading
        }
    }

}


final class ElectricityRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.currentRequest?.url, let target = request.url,
              ["http","https"].contains(target.scheme ?? ""), target.scheme == original.scheme, target.host == original.host, target.port == nil,
              target.user == nil, target.password == nil else { completionHandler(nil); return }
        completionHandler(request)
    }
}
