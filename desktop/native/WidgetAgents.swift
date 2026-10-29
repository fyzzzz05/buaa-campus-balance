import Foundation

enum WidgetAgents {
    private static let label = "edu.buaa.campusbalance.widget-refresh"
    private static let bridgeLabel = "edu.buaa.campusbalance.widget-bridge"
    private static let home = FileManager.default.homeDirectoryForCurrentUser
    private static var agents: URL { home.appendingPathComponent("Library/LaunchAgents",isDirectory:true) }
    private static var config: URL { home.appendingPathComponent("Library/Application Support/CampusBalance/widget-account.json") }
    private static func plist(_ label:String) -> URL { agents.appendingPathComponent(label + ".plist") }
    private static func launchctl(_ args:[String]) throws -> Int32 {
        let p=Process();p.executableURL=URL(fileURLWithPath:"/bin/launchctl");p.arguments=args
        p.standardOutput=FileHandle.nullDevice;p.standardError=FileHandle.nullDevice
        try p.run();p.waitUntilExit();return p.terminationStatus
    }
    private static func uidDomain() -> String { "gui/\(getuid())" }
    private static func write(_ value:[String:Any], to url:URL) throws {
        let data=try PropertyListSerialization.data(fromPropertyList:value,format:.xml,options:0)
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try data.write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
    }
    // Reuse a registered job only when identity, password policy, executable
    // paths and schedule all match. Otherwise the caller clears and replaces it.
    static func matches(configValue:[String:Any], refresh:[String:Any], bridge:[String:Any], user:String, same:Bool, resources:URL) -> Bool {
        let expectedRefresh=resources.appendingPathComponent("CampusWidgetRefresh").path
        let expectedBridge=resources.appendingPathComponent("CampusWidgetBridge").path
        let expectedHelper=resources.appendingPathComponent("CampusWidgetSnapshot").path
        let expectedToken=resources.appendingPathComponent("widget-token").path
        let schedule=refresh["StartCalendarInterval"] as? [String:Int]
        let environment=refresh["EnvironmentVariables"] as? [String:String]
        return configValue["user"] as? String == user && configValue["networkSamePassword"] as? Bool == same &&
            refresh["ProgramArguments"] as? [String] == [expectedRefresh] &&
            bridge["ProgramArguments"] as? [String] == [expectedBridge,expectedToken] &&
            environment?["CAMPUS_WIDGET_HELPER"] == expectedHelper && schedule?["Hour"] == 8 && schedule?["Minute"] == 30 &&
            refresh["RunAtLoad"] as? Bool == true && bridge["RunAtLoad"] as? Bool == true && bridge["KeepAlive"] as? Bool == true
    }
    static func isCurrent(user:String, same:Bool, resources:URL) -> Bool {
        func readPlist(_ id:String) -> [String:Any]? {
            guard let data=try? Data(contentsOf:plist(id)) else { return nil }
            return (try? PropertyListSerialization.propertyList(from:data,format:nil)) as? [String:Any]
        }
        guard let data=try? Data(contentsOf:config),let configValue=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
              let refresh=readPlist(label),let bridge=readPlist(bridgeLabel),
              matches(configValue:configValue,refresh:refresh,bridge:bridge,user:user,same:same,resources:resources) else { return false }
        return (try? launchctl(["print",uidDomain()+"/"+label])) == 0 && (try? launchctl(["print",uidDomain()+"/"+bridgeLabel])) == 0
    }
    static func disable() throws {
        for id in [label,bridgeLabel] {
            _ = try? launchctl(["bootout",uidDomain()+"/"+id])
            var stopped = false
            for attempt in 0..<30 {
                if (try? launchctl(["print",uidDomain()+"/"+id])) != 0 { stopped = true; break }
                if attempt < 29 { Thread.sleep(forTimeInterval:0.1) }
            }
            guard stopped else { throw CampusHistoryError.invalid }
            if FileManager.default.fileExists(atPath:plist(id).path) { try FileManager.default.removeItem(at:plist(id)) }
        }
        if FileManager.default.fileExists(atPath:config.path) { try FileManager.default.removeItem(at:config) }
    }
    static func enable(user:String, networkSamePassword:Bool, resources:URL) throws {
        guard user.range(of:#"^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$"#,options:.regularExpression) != nil else { throw CampusHistoryError.invalid }
        let refresh=resources.appendingPathComponent("CampusWidgetRefresh").path
        let bridge=resources.appendingPathComponent("CampusWidgetBridge").path
        let helper=resources.appendingPathComponent("CampusWidgetSnapshot").path
        let token=resources.appendingPathComponent("widget-token").path
        guard [refresh,bridge,helper,token].allSatisfy({FileManager.default.fileExists(atPath:$0)}) else { throw CampusHistoryError.invalid }
        try disable()
        try FileManager.default.createDirectory(at:config.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try JSONSerialization.data(withJSONObject:["user":user,"networkSamePassword":networkSamePassword]).write(to:config,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:config.path)
        try write(["Label":bridgeLabel,"ProgramArguments":[bridge,token],"RunAtLoad":true,"KeepAlive":true],to:plist(bridgeLabel))
        try write(["Label":label,"ProgramArguments":[refresh],"EnvironmentVariables":["CAMPUS_WIDGET_HELPER":helper],"RunAtLoad":true,"StartCalendarInterval":["Hour":8,"Minute":30]],to:plist(label))
        guard try launchctl(["bootstrap",uidDomain(),plist(bridgeLabel).path]) == 0 else { throw CampusHistoryError.invalid }
        guard try launchctl(["bootstrap",uidDomain(),plist(label).path]) == 0 else { _ = try? launchctl(["bootout",uidDomain()+"/"+bridgeLabel]); throw CampusHistoryError.invalid }
    }
}
