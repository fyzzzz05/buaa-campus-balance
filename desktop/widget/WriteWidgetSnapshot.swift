import Foundation
import WidgetKit

@main enum WidgetSnapshotWriter {
    static func main() {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        guard input.count <= 4096, let object = try? JSONSerialization.jsonObject(with: input) as? [String: Any] else { exit(1) }
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CampusBalance", isDirectory: true)
        let file = dir.appendingPathComponent("widget-snapshot.json")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            if object["action"] as? String == "clear" {
                if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
            } else {
                guard object["updatedAt"] is String, ["card", "network", "lighting", "air"].allSatisfy({ object[$0] is [String: Any] }) else { exit(1) }
                let previous = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                let output = try JSONSerialization.data(withJSONObject: mergeSnapshot(object, previous: previous))
                try output.write(to: file, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            }
            WidgetCenter.shared.reloadTimelines(ofKind: "CampusBalanceWidget")
        } catch { exit(1) }
    }
}
