import Foundation

struct CampusIssue: Error {
    enum Code: String {
        case timeout = "TIMEOUT", connection = "CONNECTION_FAILED", dns = "DNS_FAILED", tls = "TLS_FAILED", offline = "OFFLINE"
        case http = "HTTP_ERROR", redirect = "REDIRECT_BLOCKED", responseTooLarge = "RESPONSE_TOO_LARGE", invalidResponse = "INVALID_RESPONSE"
        case loginRequired = "LOGIN_REQUIRED", networkNotConfigured = "NETWORK_NOT_CONFIGURED", quotaTableMissing = "QUOTA_TABLE_MISSING", quotaValueInvalid = "QUOTA_VALUE_INVALID"
        case meterIDMismatch = "METER_ID_MISMATCH", meterKindMismatch = "METER_KIND_MISMATCH", fieldMissing = "FIELD_MISSING", meterValueInvalid = "METER_VALUE_INVALID"
        case historyIncomplete = "HISTORY_INCOMPLETE", keychain = "KEYCHAIN_FAILED", unknown = "UNKNOWN"
        var message: String {
            switch self {
            case .timeout: return "学校服务请求超时"
            case .connection: return "无法连接学校服务"
            case .dns: return "学校域名解析失败"
            case .tls: return "学校 HTTPS 证书或握手失败"
            case .offline: return "当前网络不可用"
            case .http: return "学校服务返回错误"
            case .redirect: return "学校服务跳转异常"
            case .responseTooLarge: return "学校响应超过大小限制"
            case .invalidResponse: return "学校响应格式异常"
            case .loginRequired: return "学校登录未完成或已失效，请重新登录"
            case .networkNotConfigured: return "未启用校园网登录，请使用账号密码登录并勾选相同密码"
            case .quotaTableMissing: return "校园网流量表缺失，学校页面可能已变化"
            case .quotaValueInvalid: return "校园网流量数值或单位无法识别"
            case .meterIDMismatch: return "学校返回的电表号与设置不符"
            case .meterKindMismatch: return "学校返回的电表类型与设置不符"
            case .fieldMissing: return "学校页面缺少字段"
            case .meterValueInvalid: return "学校返回的电价或剩余电量无效"
            case .historyIncomplete: return "学校流水分页不完整"
            case .keychain: return "无法读取自动登录密码，请检查钥匙串"
            case .unknown: return "查询失败，原因尚未识别"
            }
        }
    }
    enum Field: String { case meterID = "电表号", address = "地址", price = "电价", quantity = "剩余电量", free = "免费流量剩余", paid = "计费流量剩余", used = "已用流量" }
    let code: Code
    var field: Field? = nil
    var httpStatus: Int? = nil
    var stage: CampusDiagnostics.Stage? = nil
    var transportCode: Int? = nil
    enum Transport: String { case https, http }
    var transport: Transport = .https
}

enum CampusDiagnostics {
    enum Stage: String {
        case schoolLogin, cardBalance, cardHistory, networkBalance, networkAuth, networkHistory, electricityMeter, lightingMeter, airMeter, electricityHistory, autoLogin
        var endpoint: String? {
            switch self {
            case .schoolLogin: return "https://sso.buaa.edu.cn/login"
            case .cardBalance: return "https://www.cc-pay.cn/api/campus_card/balance"
            case .cardHistory: return "https://mall.cc-pay.cn/api/campus_card/trades"
            case .networkBalance: return "https://zfw.buaa.edu.cn/home"
            case .networkAuth: return "https://zfw.buaa.edu.cn/site/sso"
            case .networkHistory: return "https://zfw.buaa.edu.cn/log/detail"
            case .electricityMeter, .lightingMeter, .airMeter: return "https://shsd.buaa.edu.cn/PubBuaa"
            case .electricityHistory: return "https://raw.githubusercontent.com"
            case .autoLogin: return nil
            }
        }
    }
    static func issue(_ error: Error) -> CampusIssue {
        if let known = error as? CampusIssue { return known }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            switch ns.code {
            case NSURLErrorTimedOut: return CampusIssue(code:.timeout)
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: return CampusIssue(code:.dns)
            case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost: return CampusIssue(code:.connection)
            case NSURLErrorNotConnectedToInternet: return CampusIssue(code:.offline)
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected, NSURLErrorClientCertificateRequired: return CampusIssue(code:.tls)
            default: return CampusIssue(code:.unknown)
            }
        }
        if let school = error as? NativeSchoolError {
            switch school {
            case .loginFailed: return CampusIssue(code:.loginRequired)
            case .unavailable, .invalidResponse: return CampusIssue(code:.invalidResponse)
            }
        }
        if let history = error as? CampusHistoryError {
            switch history {
            case .invalid: return CampusIssue(code:.invalidResponse)
            case .incomplete: return CampusIssue(code:.historyIncomplete)
            }
        }
        if let transport = error as? SchoolHTTPError {
            switch transport {
            case .disallowedURL: return CampusIssue(code:.redirect)
            case .responseTooLarge: return CampusIssue(code:.responseTooLarge)
            case .unexpectedResponse: return CampusIssue(code:.invalidResponse)
            }
        }
        if ns.domain == XMLParser.errorDomain || (ns.domain == NSCocoaErrorDomain && ns.code == 3840) { return CampusIssue(code:.invalidResponse) }
        return CampusIssue(code:.unknown)
    }
    static func describe(_ error: Error, stage: Stage) -> [String: Any] {
        let issue = issue(error)
        let stage = issue.stage ?? stage
        var message = issue.code.message
        if let field = issue.field { message += "：" + field.rawValue }
        if let status = issue.httpStatus { message += "（HTTP \(status)）" }
        var record: [String: Any] = ["code":issue.code.rawValue,"stage":stage.rawValue,"message":message]
        if let endpoint = stage.endpoint {
            let allowsHTTP = [.electricityMeter, .lightingMeter, .airMeter].contains(stage)
            let useHTTP = issue.transport == .http && allowsHTTP
            record["endpoint"] = useHTTP ? endpoint.replacingOccurrences(of:"https://",with:"http://") : endpoint
            record["scheme"] = useHTTP ? "http" : "https"; record["port"] = useHTTP ? 80 : 443
        }
        if let field = issue.field { record["field"] = field.rawValue }
        if let status = issue.httpStatus { record["httpStatus"] = status }
        if let code = issue.transportCode { record["transportCode"] = code }
        else if (error as NSError).domain == NSURLErrorDomain { record["transportCode"] = (error as NSError).code }
        return record
    }
    static func contextualize(_ error: Error, url: URL) -> CampusIssue {
        var value = issue(error)
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { value.transportCode = ns.code }
        switch (url.host, url.path) {
        case ("zfw.buaa.edu.cn", "/site/sso"): value.stage = .networkAuth
        case ("zfw.buaa.edu.cn", "/log/detail"): value.stage = .networkHistory
        case ("zfw.buaa.edu.cn", _): value.stage = .networkBalance
        case ("sso.buaa.edu.cn", _): value.stage = .schoolLogin
        case ("mall.cc-pay.cn", _): value.stage = .cardHistory
        default: break
        }
        return value
    }
    private static let lock = NSLock()
    static func write(_ record: [String: Any], directory: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/CampusBalance")) {
        lock.lock(); defer { lock.unlock() }
        do {
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let target = directory.appendingPathComponent("diagnostics.ndjson")
            if let size = (try? FileManager.default.attributesOfItem(atPath:target.path)[.size]) as? NSNumber, size.intValue >= 262144 {
                let previous = directory.appendingPathComponent("diagnostics.ndjson.1")
                if FileManager.default.fileExists(atPath:previous.path) { try FileManager.default.removeItem(at:previous) }
                try FileManager.default.moveItem(at:target,to:previous)
            }
            var value = record; value["time"] = ISO8601DateFormatter().string(from:Date())
            var data = try JSONSerialization.data(withJSONObject:value); data.append(10)
            if !FileManager.default.fileExists(atPath:target.path) { FileManager.default.createFile(atPath:target.path,contents:nil,attributes:[.posixPermissions:0o600]) }
            let handle = try FileHandle(forWritingTo:target); defer { try? handle.close() }
            try handle.seekToEnd(); try handle.write(contentsOf:data)
        } catch { /* Diagnostics must not stop balance queries. */ }
    }
    static func report(_ error: Error, stage: Stage) -> [String: Any] {
        let diagnostic = describe(error,stage:stage); write(diagnostic); return diagnostic
    }
    static func failure(_ error: Error, stage: Stage, status: String = "unavailable") -> [String: Any] {
        let diagnostic = report(error,stage:stage)
        return ["status":status,"note":diagnostic["message"] as? String ?? "查询失败","diagnostic":diagnostic]
    }
}
