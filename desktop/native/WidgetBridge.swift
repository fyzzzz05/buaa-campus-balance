import Foundation
import Network

// This service exposes only the already-sanitized snapshot on loopback.
// The token and data stay in owner-readable files; credentials never enter it.
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
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let path = URL(fileURLWithPath: home).appendingPathComponent("Library/Application Support/CampusBalance/widget-snapshot.json")
        let queue = DispatchQueue(label: "edu.buaa.campusbalance.widgetbridge")
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            read(connection, buffer: Data(), token: token, path: path)
        }
        listener.stateUpdateHandler = { state in
            if case .failed = state { exit(1) }
        }
        listener.start(queue: queue)
        dispatchMain()
    }

    static func read(_ connection: NWConnection, buffer: Data, token: String, path: URL) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, done, error in
            var accumulated = buffer
            if let data { accumulated.append(data) }
            if accumulated.count > 8192 || error != nil { connection.cancel(); return }
            guard let text = String(data: accumulated, encoding: .utf8), text.contains("\r\n\r\n") else {
                if done { connection.cancel() } else { read(connection, buffer: accumulated, token: token, path: path) }
                return
            }
            let lines = text.components(separatedBy: "\r\n")
            let request = lines.first?.split(separator: " ") ?? []
            let auth = lines.dropFirst().first { $0.lowercased().hasPrefix("authorization:") }?
                .split(separator: ":", maxSplits: 1).last?.trimmingCharacters(in: .whitespaces) ?? ""
            let expected = Array("Bearer \(token)".utf8), supplied = Array(auth.utf8)
            var difference: UInt8 = supplied.count == expected.count ? 0 : 1
            for i in expected.indices { difference |= expected[i] ^ (i < supplied.count ? supplied[i] : 0) }
            let allowed = request.count == 3 && request[0] == "GET" && request[1] == "/snapshot" && difference == 0
            let body = allowed ? ((try? Data(contentsOf: path)).flatMap { $0.count <= 4096 ? $0 : nil }) : nil
            let payload = body ?? Data()
            let status = body == nil ? "404 Not Found" : "200 OK"
            let headers = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: \(payload.count)\r\nConnection: close\r\n\r\n"
            var response = Data(headers.utf8); response.append(payload)
            connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
