import Foundation

func mergeSnapshot(_ fresh: [String: Any], previous: [String: Any]?) -> [String: Any] {
    var merged=fresh
    guard let previous else { return merged }
    for key in ["card", "network", "lighting", "air"] {
        guard let current=merged[key] as? [String: Any], current["value"] is NSNull,
              var old=previous[key] as? [String: Any], old["value"] is NSNumber else { continue }
        old["note"]="更新失败"
        merged[key]=old
    }
    return merged
}
