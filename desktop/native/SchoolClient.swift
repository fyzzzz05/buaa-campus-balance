import Foundation
import CryptoKit
import os

struct NativeSchoolSession {
    let user: String
    let networkDigest: String?
}

enum NativeSchoolError: Error { case loginFailed, unavailable, invalidResponse }

final class NativeSchoolClient {
    private let http: SchoolHTTP
    init(http: SchoolHTTP = SchoolHTTP()) { self.http = http }

    private func makeURL(_ string: String, query: [URLQueryItem] = []) throws -> URL {
        guard var components = URLComponents(string: string) else { throw NativeSchoolError.invalidResponse }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url, SchoolRedirectPolicy.allowed(url) else { throw NativeSchoolError.invalidResponse }
        return url
    }

    private func json(_ url: URL) async throws -> [String: Any] {
        var request = URLRequest(url: url); request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await http.request(request)
        guard response.statusCode == 200, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NativeSchoolError.invalidResponse }
        return object
    }

    func login(user: String, password: String, networkSamePassword: Bool) async throws -> NativeSchoolSession {
        guard user.range(of: #"^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$"#, options: .regularExpression) != nil,
              !password.isEmpty, password.utf8.count <= 1024 else { throw NativeSchoolError.loginFailed }
        let log = Logger(subsystem:"edu.buaa.campusbalance",category:"performance")
        let overallStart = Date()
        let start = try makeURL("https://www.cc-pay.cn/login", query: [URLQueryItem(name: "channel", value: "BUAASSO")])
        let (data, response) = try await http.request(URLRequest(url: start))
        guard response.statusCode == 200, let url = response.url, let html = String(data: data, encoding: .utf8) else { throw NativeSchoolError.unavailable }
        log.info("login form request ms=\(Int(Date().timeIntervalSince(overallStart)*1000), privacy: .public)")
        let form = try SchoolHTML.loginForm(html, at: url)
        var fields = form.fields
        fields["username"] = user; fields["password"] = password; fields["submit"] = "LOGIN"
        var encoded = URLComponents(); encoded.queryItems = fields.keys.sorted().map { URLQueryItem(name: $0, value: fields[$0]) }
        // URLComponents leaves '+' unescaped; application/x-www-form-urlencoded
        // decodes it as a space, so encode it explicitly before submission.
        guard let body = encoded.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8) else { throw NativeSchoolError.invalidResponse }
        var login = URLRequest(url: form.action)
        login.httpMethod = "POST"; login.httpBody = body
        login.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        login.setValue("https://sso.buaa.edu.cn", forHTTPHeaderField: "Origin")
        login.setValue(url.absoluteString, forHTTPHeaderField: "Referer")
        let submitStart = Date()
        _ = try await http.request(login)
        log.info("login submission ms=\(Int(Date().timeIntervalSince(submitStart)*1000), privacy: .public)")
        let accountStart = Date()
        let account = try await json(makeURL("https://www.cc-pay.cn/api/user"))
        log.info("login account verification ms=\(Int(Date().timeIntervalSince(accountStart)*1000), privacy: .public)")
        guard account["success"] as? Bool == true, account["data"] is [String: Any] else { throw NativeSchoolError.loginFailed }
        let digest = networkSamePassword ? Insecure.MD5.hash(data: Data(password.utf8)).map { String(format: "%02x", $0) }.joined() : nil
        return NativeSchoolSession(user: user, networkDigest: digest)
    }

    #if CAMPUS_TESTING
    func exportSchoolCookies() -> [[String:String]] { http.exportSchoolCookies() }
    #endif
    func loginWithCookies(_ cookies: [[String:String]]) async throws -> NativeSchoolSession {
        try http.importSchoolCookies(cookies)
        func account() async throws -> [String:Any] { try await json(makeURL("https://www.cc-pay.cn/api/user")) }
        var profile = try await account()
        if profile["success"] as? Bool != true {
            _ = try await http.request(URLRequest(url:makeURL("https://www.cc-pay.cn/login",query:[URLQueryItem(name:"channel",value:"BUAASSO")])))
            profile = try await account()
        }
        guard profile["success"] as? Bool == true, let data = profile["data"] as? [String:Any] else { throw NativeSchoolError.loginFailed }
        let cards = try await json(makeURL("https://www.cc-pay.cn/api/campus_cards"))
        guard cards["success"] as? Bool == true else { throw NativeSchoolError.loginFailed }
        let nested = cards["data"] as? [String:Any]
        let list = (cards["data"] as? [[String:Any]]) ?? (nested?["data"] as? [[String:Any]]) ?? (nested?["list"] as? [[String:Any]]) ?? (nested?["records"] as? [[String:Any]]) ?? []
        let value = list.first?["stuNo"] ?? data["stuNo"] ?? data["userName"] ?? data["username"] ?? data["account"]
        guard let user = value.map({"\($0)"}), user.range(of:#"^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$"#,options:.regularExpression) != nil else { throw NativeSchoolError.invalidResponse }
        return NativeSchoolSession(user:user,networkDigest:nil)
    }

    func cardBalanceAndNumber(_ current: NativeSchoolSession) async throws -> (value: Double, number: String) {
        var cards = try await json(makeURL("https://www.cc-pay.cn/api/campus_cards"))
        if cards["success"] as? Bool != true {
            _ = try await http.request(URLRequest(url: makeURL("https://www.cc-pay.cn/login", query: [URLQueryItem(name: "channel", value: "BUAASSO")])))
            cards = try await json(makeURL("https://www.cc-pay.cn/api/campus_cards"))
        }
        guard cards["success"] as? Bool == true else { throw NativeSchoolError.loginFailed }
        let data = cards["data"] as? [String: Any]
        let list = (cards["data"] as? [[String: Any]]) ?? (data?["data"] as? [[String: Any]]) ?? (data?["list"] as? [[String: Any]]) ?? (data?["records"] as? [[String: Any]]) ?? []
        let number = list.first?["stuNo"].map { "\($0)" } ?? current.user
        let payload = try await json(makeURL("https://www.cc-pay.cn/api/campus_card/balance", query: [URLQueryItem(name: "stuNo", value: number)]))
        guard payload["success"] as? Bool == true, let item = payload["data"] as? [String: Any], let raw = item["balance"], !(raw is NSNull),
              let value = Double("\(raw)"), value.isFinite else { throw NativeSchoolError.unavailable }
        return (value, number)
    }

    func cardBalance(_ current: NativeSchoolSession) async throws -> Double {
        try await cardBalanceAndNumber(current).value
    }

    func networkBalance(_ current: NativeSchoolSession) async throws -> NetworkQuota {
        guard let digest = current.networkDigest else { throw NativeSchoolError.unavailable }
        let home = try makeURL("https://zfw.buaa.edu.cn/home")
        func read() async throws -> NetworkQuota {
            let (data, _) = try await http.request(URLRequest(url: home))
            guard let html = String(data: data, encoding: .utf8) else { throw NativeSchoolError.invalidResponse }
            return try SchoolHTML.quota(html)
        }
        if let quota = try? await read() { return quota }
        let sso = Data("zh-CN:\(current.user):\(digest)".utf8).base64EncodedString()
        let url = try makeURL("https://zfw.buaa.edu.cn/site/sso", query: [URLQueryItem(name: "data", value: sso)])
        _ = try await http.request(URLRequest(url: url))
        return try await read()
    }
    static func recentDays(count: Int, now: Date = Date()) -> [String] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        let today = calendar.startOfDay(for: now)
        return (0..<count).compactMap { calendar.date(byAdding: .day, value: $0 - count + 1, to: today).map { formatter.string(from: $0) } }
    }

    func networkHistory(days: [String] = NativeSchoolClient.recentDays(count: 14)) async throws -> CampusHistoryResult {
        guard let first = days.first, let last = days.last else { throw CampusHistoryError.invalid }
        var result = NetworkHistoryAccumulator(days: days)
        for page in 1...50 {
            let url = try makeURL("https://zfw.buaa.edu.cn/log/detail", query: [
                URLQueryItem(name: "DetailLogSearch[start_time]", value: first + " 00:00:00"),
                URLQueryItem(name: "DetailLogSearch[end_time]", value: last + " 23:59:59"), URLQueryItem(name: "page", value: String(page))])
            let (data, response) = try await http.request(URLRequest(url: url))
            guard response.statusCode == 200, let html = String(data: data, encoding: .utf8) else { throw CampusHistoryError.invalid }
            let parsed = try SchoolHTML.networkPage(html)
            if try result.appendPage(total: parsed.total, rows: parsed.rows) { return result.result() }
        }
        throw CampusHistoryError.incomplete
    }

    func cardHistory(user: String, days: [String] = NativeSchoolClient.recentDays(count: 14)) async throws -> CampusHistoryResult {
        guard let first = days.first, let last = days.last else { throw CampusHistoryError.invalid }
        let input = ISO8601DateFormatter(); input.formatOptions = [.withInternetDateTime]
        guard let start = input.date(from: first + "T00:00:00+08:00"), let end = input.date(from: last + "T00:00:00+08:00")?.addingTimeInterval(86400) else { throw CampusHistoryError.invalid }
        input.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var result = CardTradeAccumulator(days: days)
        for page in 1...20 {
            let url = try makeURL("https://mall.cc-pay.cn/api/campus_card/trades", query: [
                URLQueryItem(name:"t",value:String(Int(Date().timeIntervalSince1970 * 1000))), URLQueryItem(name:"pageSize",value:"100"),
                URLQueryItem(name:"pageNum",value:String(page)), URLQueryItem(name:"minTsCreation",value:input.string(from:start)),
                URLQueryItem(name:"maxTsCreation",value:input.string(from:end)), URLQueryItem(name:"tradeType",value:"all"), URLQueryItem(name:"stuNo",value:user)])
            var request = URLRequest(url: url)
            request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
            request.setValue(try makeURL("https://mall.cc-pay.cn/cardInquiry", query: [URLQueryItem(name:"stuNo",value:user),URLQueryItem(name:"linkfrom",value:"pass")]).absoluteString, forHTTPHeaderField: "Referer")
            let (data, response) = try await http.request(request)
            guard response.statusCode == 200, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CampusHistoryError.invalid }
            if try result.appendPage(object) { return result.result() }
        }
        throw CampusHistoryError.incomplete
    }

}
