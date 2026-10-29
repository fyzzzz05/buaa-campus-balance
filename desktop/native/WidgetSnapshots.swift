import Foundation

enum WidgetSnapshots {
    static func send(_ body: [String:Any]) throws {
        guard let helper = ProcessInfo.processInfo.environment["CAMPUS_WIDGET_HELPER"], helper.hasPrefix("/") else { throw CampusHistoryError.invalid }
        let process = Process(), input = Pipe()
        process.executableURL = URL(fileURLWithPath:helper); process.standardInput = input
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run()
        input.fileHandleForWriting.write(try JSONSerialization.data(withJSONObject:body))
        try input.fileHandleForWriting.close(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw CampusHistoryError.invalid }
    }
    static func clear() throws { try send(["action":"clear"]) }
    static func publish(_ snapshot: NativeDashboardSnapshot, now: Date = Date()) throws {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        let timestamp = f.string(from:now)
        func item(_ data:[String:Any], kind:String) -> [String:Any] {
            guard data["status"] as? String == "ok", let value = data["value"] as? Double, value.isFinite, value >= 0 else { return ["value":NSNull(),"note":"暂不可用","updatedAt":NSNull()] }
            let source = data["note"] as? String ?? ""
            let note: String
            if kind == "network", source.range(of:#"^本期已用 \d+(?:\.\d+)? GB$"#,options:.regularExpression) != nil { note = source }
            else if kind == "power", source.range(of:#"^截至 \d{4}-\d{2}-\d{2}"#,options:.regularExpression) != nil { note = String(source.prefix(13)) }
            else { note = "当前余额" }
            return ["value":value,"note":note,"updatedAt":timestamp]
        }
        try send(["updatedAt":timestamp,"card":item(snapshot.card,kind:"card"),"network":item(snapshot.net,kind:"network"),
                  "lighting":item(snapshot.lighting,kind:"power"),"air":item(snapshot.air,kind:"power")])
    }
}
