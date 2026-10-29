import Foundation
import CryptoKit
import Security

struct DormSettings: Codable, Equatable {
    var dorm: String = ""
    var lighting: String = ""
    var air: String = ""
    var historyOwner: String = ""

    func validate() throws {
        guard dorm.count <= 60, dorm.unicodeScalars.allSatisfy({ $0.value >= 32 }),
              lighting.range(of: #"^(?:\d{1,30})?$"#, options: .regularExpression) != nil,
              air.range(of: #"^(?:\d{1,30})?$"#, options: .regularExpression) != nil,
              historyOwner.range(of: #"^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)?$"#, options: .regularExpression) != nil else { throw CampusHistoryError.invalid }
    }
}

enum LocalSettings {
    static func file(user: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        let digest = SHA256.hash(data: Data(user.utf8)).map { String(format: "%02x", $0) }.joined()
        return home.appendingPathComponent("Library/Application Support/CampusBalance/users", isDirectory: true).appendingPathComponent(digest + ".json")
    }
    static func read(user: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> DormSettings {
        guard let data = try? Data(contentsOf: file(user: user, home: home)),
              let value = try? JSONDecoder().decode(DormSettings.self, from: data), (try? value.validate()) != nil else { return DormSettings() }
        return value
    }
    static func write(user: String, value: DormSettings, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        try value.validate()
        let target = file(user: user, home: home)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: target, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    }
}

enum CampusKeychain {
    private static let service = "edu.buaa.campus-balance.auto-login"
    private static func query(user: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: user]
    }
    static func read(user: String) throws -> String {
        var item: CFTypeRef?
        var q = query(user: user); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        return value
    }
    static func save(user: String, password: String) throws {
        guard !password.isEmpty, password.utf8.count <= 1024, let data = password.data(using: .utf8) else { throw CampusHistoryError.invalid }
        let q = query(user: user)
        let update = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var item = q; item[kSecValueData as String] = data
            let status = SecItemAdd(item as CFDictionary, nil)
            guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        } else if update != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(update)) }
    }
    static func remove(user: String) throws {
        let status = SecItemDelete(query(user: user) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
}
