// Verify the published enclosure against the key trusted by the built app.
import Foundation
import CryptoKit

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw NSError(domain: "CampusUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

do {
    try require(CommandLine.arguments.count == 5, "Usage: verify-update.swift Info.plist appcast.xml update.dmg download-url-prefix")
    let args = CommandLine.arguments
    let plistData = try Data(contentsOf: URL(fileURLWithPath: args[1]))
    let info = try PropertyListSerialization.propertyList(from: plistData, format: nil) as! [String: Any]
    let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: Data(base64Encoded: info["SUPublicEDKey"] as? String ?? "") ?? Data())
    let document = try XMLDocument(contentsOf: URL(fileURLWithPath: args[2]), options: [.nodeLoadExternalEntitiesNever])
    let items = try document.nodes(forXPath: "/rss/channel/item")
    try require(items.count == 1, "Expected exactly one full update")
    let item = items[0] as! XMLElement
    func text(_ name: String) -> String? { item.elements(forName: "sparkle:" + name).first?.stringValue }
    try require(text("version") == info["CFBundleVersion"] as? String, "Build version mismatch")
    try require(text("shortVersionString") == info["CFBundleShortVersionString"] as? String, "Display version mismatch")
    let enclosures = item.elements(forName: "enclosure")
    try require(enclosures.count == 1, "Expected one DMG enclosure")
    let enclosure = enclosures[0]
    let archiveURL = URL(fileURLWithPath: args[3])
    let archive = try Data(contentsOf: archiveURL, options: .mappedIfSafe)
    try require(enclosure.attribute(forName: "url")?.stringValue == args[4] + archiveURL.lastPathComponent, "Download URL mismatch")
    try require(enclosure.attribute(forName: "length")?.stringValue == String(archive.count), "Archive size mismatch")
    let signature = Data(base64Encoded: enclosure.attribute(forName: "sparkle:edSignature")?.stringValue ?? "") ?? Data()
    try require(publicKey.isValidSignature(signature, for: archive), "Update signature does not match the app's trusted public key")
    print("Verified update version, URL, size and Ed25519 signature")
} catch {
    fputs("Update verification failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}
