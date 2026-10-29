import Foundation
import CryptoKit

enum CardFallback {
    static func capture(value: Double, user: String, home: URL = FileManager.default.homeDirectoryForCurrentUser, now: Date = Date()) throws -> CampusHistoryResult {
        guard value.isFinite && value >= 0 else { throw CampusHistoryError.invalid }
        let dir = home.appendingPathComponent("Library/Application Support/CampusBalance", isDirectory:true)
        let hash = SHA256.hash(data:Data(user.utf8)).map { String(format:"%02x",$0) }.joined()
        let file = dir.appendingPathComponent("card-balance-" + hash + ".json")
        var balances: [String: Double] = [:]
        for candidate in [file,dir.appendingPathComponent("card-balance.json")] {
            guard let data = try? Data(contentsOf:candidate), let object = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
                  object["user"] as? String == user, let days = object["days"] as? [String:Double] else { continue }
            balances = days; break
        }
        let today = NativeSchoolClient.recentDays(count:1,now:now)[0]; balances[today] = value
        balances = Dictionary(uniqueKeysWithValues:balances.filter { $0.key.range(of:#"^\d{4}-\d{2}-\d{2}$"#,options:.regularExpression) != nil && $0.value.isFinite && $0.value >= 0 }.sorted { $0.key < $1.key }.suffix(90).map { ($0.key,$0.value) })
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try JSONSerialization.data(withJSONObject:["user":user,"days":balances]).write(to:file,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        let days = NativeSchoolClient.recentDays(count:15,now:now)
        let history = (1..<days.count).map { i -> CampusDayValue in
            let difference = balances[days[i - 1]].flatMap { before in balances[days[i]].flatMap { after in before >= after ? ((before - after) * 100).rounded() / 100 : nil } }
            return CampusDayValue(date:days[i],value:difference)
        }
        let records = history.reversed().compactMap { item -> CampusRecord? in
            guard let amount = item.value else { return nil }
            return CampusRecord(label:"余额减少估算",date:item.date,value:String(format:"¥%.2f",amount))
        }
        return CampusHistoryResult(history:history,records:records)
    }
}
