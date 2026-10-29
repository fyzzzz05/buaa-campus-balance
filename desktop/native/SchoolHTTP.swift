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
        if [307, 308].contains(response.statusCode), original.httpBody != nil,
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
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 30
        configuration.httpShouldSetCookies = true
        configuration.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (compatible; CampusBalance/1.0)"]
        session = URLSession(configuration: configuration)
    }
    deinit { session.invalidateAndCancel() }

    func request(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url, SchoolRedirectPolicy.allowed(url) else { throw SchoolHTTPError.disallowedURL }
        let (data, response) = try await session.data(for: request, delegate: policy)
        guard data.count <= 3_000_000 else { throw SchoolHTTPError.responseTooLarge }
        guard let http = response as? HTTPURLResponse, let final = http.url, SchoolRedirectPolicy.allowed(final),
              !(300...399).contains(http.statusCode) else { throw SchoolHTTPError.unexpectedResponse }
        return (data, http)
    }
}
