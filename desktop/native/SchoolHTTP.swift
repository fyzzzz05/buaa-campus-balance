import Foundation

// Cookies are isolated to one account's ephemeral session. Redirects are
// checked before URLSession can forward a body or authentication information.
enum SchoolHTTPError: Error { case disallowedURL, responseTooLarge, unexpectedResponse }

final class SchoolRedirectPolicy: NSObject, URLSessionTaskDelegate {
    static let hosts: Set<String> = ["www.cc-pay.cn", "pass.cc-pay.cn", "mall.cc-pay.cn", "sso.buaa.edu.cn", "zfw.buaa.edu.cn"]

    static func allowed(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", let host = parts.host?.lowercased(),
              hosts.contains(host), parts.port == nil, parts.user == nil, parts.password == nil else { return false }
        return true
    }

    static func redirectAllowed(from original: URLRequest, response: HTTPURLResponse, to proposed: URLRequest) -> Bool {
        guard let target = proposed.url, allowed(target), let source = original.url, allowed(source) else { return false }
        if [307, 308].contains(response.statusCode), original.httpMethod?.uppercased() != "GET",
           source.host?.lowercased() != target.host?.lowercased() { return false }
        return true
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.currentRequest, Self.redirectAllowed(from: original, response: response, to: request) else {
            completionHandler(nil); return
        }
        completionHandler(request)
    }
}

final class SchoolHTTP {
    private let policy = SchoolRedirectPolicy()
    private let session: URLSession
    private let cookies: HTTPCookieStorage
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 30
        configuration.httpShouldSetCookies = true
        cookies = configuration.httpCookieStorage!
        configuration.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (compatible; CampusBalance/1.0)"]
        session = URLSession(configuration: configuration)
    }
    deinit { session.invalidateAndCancel() }

    #if CAMPUS_TESTING
    func exportSchoolCookies() -> [[String:String]] {
        (cookies.cookies ?? []).map { ["name":$0.name,"value":$0.value,"domain":$0.domain,"path":$0.path] }
    }
    #endif
    func importSchoolCookies(_ values: [[String:String]]) throws {
        guard values.count <= 80 else { throw SchoolHTTPError.unexpectedResponse }
        let domains = Set(["cc-pay.cn", "www.cc-pay.cn", "pass.cc-pay.cn", "mall.cc-pay.cn", "sso.buaa.edu.cn"])
        for value in values {
            guard let rawDomain = value["domain"], let name = value["name"], let content = value["value"],
                  domains.contains(rawDomain.trimmingCharacters(in: CharacterSet(charactersIn:".")).lowercased()),
                  name.range(of: #"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$"#, options:.regularExpression) != nil,
                  !content.contains(";"), !content.contains("\r"), !content.contains("\n"), content.utf8.count <= 4096 else { continue }
            let path = value["path"] ?? "/"
            guard path.hasPrefix("/"), !path.contains(";"), !path.contains("\r"), !path.contains("\n") else { continue }
            if let cookie = HTTPCookie(properties:[.domain:rawDomain,.path:path,.name:name,.value:content,.secure:"TRUE"]) { cookies.setCookie(cookie) }
        }
    }

    func request(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url, SchoolRedirectPolicy.allowed(url) else { throw SchoolHTTPError.disallowedURL }
        do {
            let (data, response) = try await session.data(for: request, delegate: policy)
            guard data.count <= 3_000_000 else { throw CampusIssue(code:.responseTooLarge) }
            guard let http = response as? HTTPURLResponse, let final = http.url, SchoolRedirectPolicy.allowed(final) else { throw CampusIssue(code:.invalidResponse) }
            guard !(300...399).contains(http.statusCode) else { throw CampusIssue(code:.redirect) }
            guard http.statusCode != 401 else { throw CampusIssue(code:.loginRequired,httpStatus:401) }
            guard (200...299).contains(http.statusCode) else { throw CampusIssue(code:.http,httpStatus:http.statusCode) }
            return (data, http)
        } catch { throw CampusDiagnostics.contextualize(error,url:url) }
    }
}
