import Foundation

@main enum WidgetRefresh {
    static func main() async {
        do {
            let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CampusBalance")
            let data = try Data(contentsOf:dir.appendingPathComponent("widget-account.json"))
            guard let config = try JSONSerialization.jsonObject(with:data) as? [String:Any], let user = config["user"] as? String,
                  user.range(of:#"^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$"#,options:.regularExpression) != nil else { exit(1) }
            let password = try CampusKeychain.read(user:user)
            let client = NativeSchoolClient()
            let current = try await client.login(user:user,password:password,networkSamePassword:config["networkSamePassword"] as? Bool == true)
            let dashboard = NativeDashboard(client:client,current:current,autoLogin:false)
            let snapshot = await dashboard.refresh(balanceOnly:true)
            try WidgetSnapshots.publish(snapshot)
        } catch { exit(1) }
    }
}
