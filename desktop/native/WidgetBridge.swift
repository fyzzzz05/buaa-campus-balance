import Foundation
import Network

// The widget can read sanitized balances and request a refresh. Credentials
// remain in the existing, unsandboxed refresh worker's Keychain access.
private final class WidgetRefresher {
    let queue: DispatchQueue
    let resources: URL
    let home: URL
    private var process: Process?
    private var waiting: [(String) -> Void] = []
    private var timeout: DispatchWorkItem?

    init(queue: DispatchQueue, resources: URL, home: URL) {
        self.queue = queue; self.resources = resources; self.home = home
    }

    func refresh(_ completion: @escaping (String) -> Void) {
        if process != nil { waiting.append(completion); return }
        let account = home.appendingPathComponent("Library/Application Support/CampusBalance/widget-account.json")
        guard FileManager.default.fileExists(atPath: account.path) else { completion("409 Conflict"); return }
        let worker = resources.appendingPathComponent("CampusWidgetRefresh")
        let helper = resources.appendingPathComponent("CampusWidgetSnapshot")
        guard FileManager.default.isExecutableFile(atPath: worker.path), FileManager.default.isExecutableFile(atPath: helper.path) else {
            completion("503 Service Unavailable"); return
        }
        let child = Process()
        child.executableURL = worker
        var environment = ProcessInfo.processInfo.environment
        environment["CAMPUS_WIDGET_HELPER"] = helper.path
        child.environment = environment
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { [weak self] finished in
            guard let self else { return }
            self.queue.async { self.finish(finished, status: finished.terminationStatus == 0 ? "200 OK" : "503 Service Unavailable") }
        }
        process = child; waiting = [completion]
        do { try child.run() }
        catch { finish(child, status: "503 Service Unavailable"); return }
        let deadline = DispatchWorkItem { [weak self, weak child] in
            guard let self, let child, self.process === child else { return }
            if child.isRunning { child.terminate() }
            self.finish(child, status: "504 Gateway Timeout")
        }
        timeout = deadline
        queue.asyncAfter(deadline: .now() + 45, execute: deadline)
    }

    private func finish(_ child: Process, status: String) {
        guard process === child else { return }
        timeout?.cancel(); timeout = nil; process = nil
        let callbacks = waiting; waiting = []
        callbacks.forEach { $0(status) }
    }
}

@main enum WidgetBridge {
    static func main() throws {
        guard CommandLine.arguments.count == 2,
              let token = try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { exit(1) }
        let portValue = UInt16(ProcessInfo.processInfo.environment["CAMPUS_WIDGET_BRIDGE_PORT"] ?? "49771") ?? 49771
        guard let port = NWEndpoint.Port(rawValue: portValue) else { exit(1) }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
        let listener = try NWListener(using: parameters)
        let home = URL(fileURLWithPath: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
        let path = home.appendingPathComponent("Library/Application Support/CampusBalance/widget-snapshot.json")
        let queue = DispatchQueue(label: "edu.buaa.campusbalance.widgetbridge")
        let refresher = WidgetRefresher(queue: queue, resources: URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent(), home: home)
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            read(connection, buffer: Data(), token: token, port: portValue, path: path, refresher: refresher)
        }
        listener.stateUpdateHandler = { state in
            if case .failed = state { exit(1) }
        }
        listener.start(queue: queue)
        dispatchMain()
    }

    private static func respond(_ connection: NWConnection, status: String, body: Data = Data()) {
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var response = Data(headers.utf8); response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    private static func read(_ connection: NWConnection, buffer: Data, token: String, port: UInt16, path: URL, refresher: WidgetRefresher) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, done, error in
            var accumulated = buffer
            if let data { accumulated.append(data) }
            if accumulated.count > 8192 || error != nil { connection.cancel(); return }
            guard let text = String(data: accumulated, encoding: .utf8), text.contains("\r\n\r\n") else {
                if done { connection.cancel() } else { read(connection, buffer: accumulated, token: token, port: port, path: path, refresher: refresher) }
                return
            }
            let lines = text.components(separatedBy: "\r\n")
            let request = lines.first?.split(separator: " ") ?? []
            // Stop at the end of headers; request bodies cannot supply headers.
            let headers = Array(lines.dropFirst().prefix { !$0.isEmpty })
            func header(_ name: String) -> String? {
                headers.first { $0.lowercased().hasPrefix(name + ":") }?
                    .split(separator: ":", maxSplits: 1).last?.trimmingCharacters(in: .whitespaces)
            }
            let auth = header("authorization") ?? ""
            let expected = Array("Bearer \(token)".utf8), supplied = Array(auth.utf8)
            var difference: UInt8 = supplied.count == expected.count ? 0 : 1
            for i in expected.indices { difference |= expected[i] ^ (i < supplied.count ? supplied[i] : 0) }
            guard request.count == 3, difference == 0, header("origin") == nil, header("host") == "127.0.0.1:\(port)" else {
                respond(connection, status: "404 Not Found"); return
            }
            if request[0] == "POST", request[1] == "/refresh" {
                refresher.refresh { status in respond(connection, status: status) }
            } else if request[0] == "GET", request[1] == "/snapshot" {
                let body = (try? Data(contentsOf: path)).flatMap { $0.count <= 4096 ? $0 : nil }
                respond(connection, status: body == nil ? "404 Not Found" : "200 OK", body: body ?? Data())
            } else { respond(connection, status: "404 Not Found") }
        }
    }
}
