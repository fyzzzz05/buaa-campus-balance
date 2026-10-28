import AppKit
import WebKit
import Security
import Sparkle

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var server: Process?
    private var pendingOutput = ""
    private var terminating = false
    private var updaterController: SPUStandardUpdaterController!
    private var localURL: URL!
    private var nativeToken = ""
    private var schoolLogin = false
    private var completingSchoolLogin = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        updaterController = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        configureMenu()
        let rect = NSRect(x: 0, y: 0, width: 1050, height: 720)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "校园余额"
        window.minSize = NSSize(width: 340, height: 560)
        window.center()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addUserScript(WKUserScript(source: "if (location.hostname === '127.0.0.1') window.__campusNative = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do { try startServer() }
        catch { fail("无法启动校园余额，请重新打开应用。") }
    }

    private func configureMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于校园余额", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        let updateItem = NSMenuItem(title: "检查更新…", action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: "")
        updateItem.target = updaterController
        appMenu.addItem(updateItem)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出校园余额", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }

    private func sessionSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let randomStatus = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard randomStatus == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(randomStatus)) }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func startServer() throws {
        guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "Campus", code: 1) }
        let process = Process(), output = Pipe(), input = Pipe()
        process.executableURL = resources.appendingPathComponent("node")
        process.arguments = [resources.appendingPathComponent("app/dev.js").path]
        process.currentDirectoryURL = resources.appendingPathComponent("app")
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "VERCEL")
        environment["NODE_ENV"] = "local"
        environment["CAMPUS_APP"] = "1"
        environment["CAMPUS_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        environment["PORT"] = "0"
        environment.removeValue(forKey: "SESSION_SECRET")
        let secret = try sessionSecret()
        nativeToken = secret
        process.environment = environment
        process.standardOutput = output
        process.standardInput = input
        process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.consume(text, handle: handle) }
        }
        process.terminationHandler = { [weak self] process in
            if process.terminationStatus != 0 { DispatchQueue.main.async { if self?.terminating == false { self?.fail("校园余额服务已停止，请重新打开应用。") } } }
        }
        try process.run()
        input.fileHandleForWriting.write(Data(secret.utf8))
        try? input.fileHandleForWriting.close()
        server = process
    }

    private func consume(_ text: String, handle: FileHandle) {
        pendingOutput += text
        guard let line = pendingOutput.split(separator: "\n").first(where: { $0.hasPrefix("READY ") }),
              let port = Int(line.dropFirst(6)), (1...65535).contains(port),
              let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        handle.readabilityHandler = nil
        localURL = url
        web.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.host == "127.0.0.1", url.path == "/sso/start" {
            schoolLogin = true
            decisionHandler(.cancel)
            web.load(URLRequest(url: URL(string: "https://www.cc-pay.cn/login?channel=BUAASSO")!))
        }
        else if schoolLogin && url.scheme == "https" && ["www.cc-pay.cn", "pass.cc-pay.cn", "mall.cc-pay.cn", "sso.buaa.edu.cn"].contains(url.host ?? "") { decisionHandler(.allow) }
        else if url.host == "127.0.0.1" || url.scheme == "about" { decisionHandler(.allow) }
        else { decisionHandler(.cancel); NSWorkspace.shared.open(url) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard schoolLogin, !completingSchoolLogin, ["www.cc-pay.cn", "pass.cc-pay.cn", "mall.cc-pay.cn"].contains(webView.url?.host ?? "") else { return }
        completingSchoolLogin = true
        let attemptedURL = webView.url
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let allowed = Set(["cc-pay.cn", "www.cc-pay.cn", "pass.cc-pay.cn", "mall.cc-pay.cn", "sso.buaa.edu.cn"])
            let values: [[String: String]] = cookies.filter { allowed.contains($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()) }.map { ["name": $0.name, "value": $0.value, "domain": $0.domain, "path": $0.path] }
            guard let body = try? JSONSerialization.data(withJSONObject: ["action": "school-session", "cookies": values]), let url = URL(string: "/api/auth", relativeTo: self.localURL) else { self.completingSchoolLogin = false; return }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(self.nativeToken, forHTTPHeaderField: "X-Campus-Native-Token")
            request.httpBody = body
            let config = URLSessionConfiguration.ephemeral
            let session = URLSession(configuration: config)
            session.dataTask(with: request) { [weak self] _, response, _ in
                guard let self else { return }
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    DispatchQueue.main.async {
                        self.completingSchoolLogin = false
                        if webView.url != attemptedURL { self.webView(webView, didFinish: nil) }
                    }
                    return
                }
                let localCookies = config.httpCookieStorage?.cookies(for: self.localURL) ?? []
                let group = DispatchGroup()
                for cookie in localCookies { group.enter(); webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() } }
                group.notify(queue: .main) {
                    self.schoolLogin = false
                    self.completingSchoolLogin = false
                    webView.load(URLRequest(url: self.localURL.appendingPathComponent("dashboard")))
                }
            }.resume()
        }
    }

    private func fail(_ message: String) {
        let alert = NSAlert(); alert.messageText = "校园余额"; alert.informativeText = message; alert.runModal()
        NSApp.terminate(nil)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { terminating = true; if let server, server.isRunning { server.terminate() } }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
