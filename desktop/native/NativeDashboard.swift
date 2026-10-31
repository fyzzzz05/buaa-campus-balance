import Foundation

struct NativeDashboardSnapshot {
    let card: [String: Any]
    let net: [String: Any]
    let lighting: [String: Any]
    let air: [String: Any]
    var data: [String: Any] { ["card":card, "net":net, "lighting":lighting, "air":air] }
}

actor NativeDashboard {
    private var client: NativeSchoolClient
    private var current: NativeSchoolSession
    private let autoLogin: Bool
    init(client: NativeSchoolClient, current: NativeSchoolSession, autoLogin: Bool) {
        self.client = client; self.current = current; self.autoLogin = autoLogin
    }

    private func encodeHistory(_ values: [CampusDayValue]) -> [[String: Any]] {
        values.map { ["date":$0.date, "value":$0.value.map { $0 as Any } ?? NSNull()] }
    }
    private func encodeRecords(_ records: [CampusRecord]) -> [[String: Any]] {
        records.map { ["label":$0.label, "date":$0.date, "value":$0.value] }
    }
    private func cardData(balanceOnly: Bool = false) async throws -> [String: Any] {
        let (value, number) = try await client.cardBalanceAndNumber(current)
        var data: [String: Any] = ["status":"ok", "value":value, "unit":"元", "note":"当前余额"]
        if balanceOnly { return data }
        do {
            let history = try await client.cardHistory(user:number)
            data["history"] = encodeHistory(history.history); data["records"] = encodeRecords(history.records)
            data["historyNote"] = "校园卡消费 · 元"; data["historySource"] = "transactions"
        } catch {
            let diagnostic = CampusDiagnostics.report(error,stage:.cardHistory)
            data["historyDiagnostic"] = diagnostic
            if let fallback = try? CardFallback.capture(value:value,user:current.user) {
                data["history"] = encodeHistory(fallback.history); data["records"] = encodeRecords(fallback.records)
                data["historyNote"] = "余额减少估算 · " + (diagnostic["message"] as? String ?? "消费流水查询失败"); data["emptyNote"] = "暂无消费明细"
            } else { data["historyNote"] = diagnostic["message"] }
        }
        return data
    }
    private func networkData(balanceOnly: Bool = false) async throws -> [String: Any] {
        let quota = try await client.networkBalance(current)
        var data: [String: Any] = ["status":"ok", "value":quota.free + quota.paid, "unit":"GB", "note":String(format:"本期已用 %.2f GB",quota.used)]
        if balanceOnly { return data }
        do {
            let history = try await client.networkHistory()
            data["history"] = encodeHistory(history.history); data["records"] = encodeRecords(history.records); data["historyNote"] = "按学校结算日 · GB"
        } catch {
            let diagnostic = CampusDiagnostics.report(error,stage:.networkHistory)
            data["historyNote"] = diagnostic["message"]; data["historyDiagnostic"] = diagnostic
        }
        return data
    }
    private func electricityData() async -> [String: [String: Any]] {
        let settings = LocalSettings.read(user: current.user)
        let config = ElectricityConfig(lighting:settings.lighting, air:settings.air, historyOwner:settings.historyOwner)
        async let historyRequest = capture { config.historyOwner.isEmpty ? [:] : try await Electricity.fetchHistory(config:config) }
        async let lightingRequest = capture { config.lighting.isEmpty ? nil : try await Electricity.fetchMeter(id:config.lighting,kind:"lighting") }
        async let airRequest = capture { config.air.isEmpty ? nil : try await Electricity.fetchMeter(id:config.air,kind:"air") }
        let (loadedHistory, lighting, air) = await (historyRequest, lightingRequest, airRequest)
        let history = (try? loadedHistory.get()) ?? [:]
        let historyDiagnostic: [String:Any]?
        if case .failure(let error) = loadedHistory { historyDiagnostic = CampusDiagnostics.report(error,stage:.electricityHistory) }
        else { historyDiagnostic = nil }
        var result: [String: [String: Any]] = [:]
        for (kind, id, loaded) in [("lighting",config.lighting,lighting),("air",config.air,air)] {
            guard !id.isEmpty else { result[kind] = ["status":"unavailable", "note":"请先设置宿舍电表"]; continue }
            let live = try? loaded.get()
            let liveDiagnostic: [String:Any]?
            if case .failure(let error) = loaded { liveDiagnostic = CampusDiagnostics.report(error,stage:kind == "air" ? .airMeter : .lightingMeter) }
            else { liveDiagnostic = nil }
            if let value = live ?? history[kind] {
                let old = history[kind]
                var data: [String:Any] = ["status":"ok", "value":value.value, "unit":"元", "note":value.note,
                    "history":encodeHistory(old?.history ?? []), "historyNote":old == nil ? "暂无历史数据" : "余额减少估算 · 元"]
                if let diagnostic = liveDiagnostic {
                    data["fallbackDiagnostic"] = diagnostic
                    data["note"] = value.note + " · 实时查询失败，显示历史余额"
                }
                if let diagnostic = live?.transportDiagnostic { data["transportDiagnostic"] = diagnostic }
                if let diagnostic = historyDiagnostic { data["historyDiagnostic"] = diagnostic; data["historyNote"] = diagnostic["message"] }
                result[kind] = data
            } else {
                let diagnostic = liveDiagnostic ?? CampusDiagnostics.describe(CampusIssue(code:.invalidResponse),stage:kind == "air" ? .airMeter : .lightingMeter)
                result[kind] = ["status":"unavailable", "note":diagnostic["message"] ?? "电表查询失败", "diagnostic":diagnostic]
                if let diagnostic = historyDiagnostic { result[kind]?["historyDiagnostic"] = diagnostic }
            }
        }
        return result
    }
    private func capture<T>(_ operation: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await operation()) } catch { return .failure(error) }
    }
    private func cardWithReauthentication(balanceOnly: Bool) async -> [String: Any] {
        do { return try await cardData(balanceOnly:balanceOnly) }
        catch {
            // A parsing or transport error must not trigger an unnecessary login.
            guard CampusDiagnostics.issue(error).code == .loginRequired else {
                return CampusDiagnostics.failure(error,stage:.cardBalance)
            }
            guard autoLogin else { return CampusDiagnostics.failure(error,stage:.cardBalance,status:"login_required") }
            let password: String
            do { password = try CampusKeychain.read(user:current.user) }
            catch { return CampusDiagnostics.failure(CampusIssue(code:.keychain),stage:.autoLogin,status:"login_required") }
            let newClient = NativeSchoolClient()
            do {
                let renewed = try await newClient.login(user:current.user,password:password,networkSamePassword:current.networkDigest != nil)
                self.client = newClient; self.current = renewed
            } catch { return CampusDiagnostics.failure(error,stage:.schoolLogin,status:"login_required") }
            do { return try await cardData(balanceOnly:balanceOnly) }
            catch { return CampusDiagnostics.failure(error,stage:.cardBalance,status:CampusDiagnostics.issue(error).code == .loginRequired ? "login_required" : "unavailable") }
        }
    }
    private func networkWithDiagnostics(balanceOnly: Bool) async -> [String:Any] {
        do { return try await networkData(balanceOnly:balanceOnly) }
        catch { return CampusDiagnostics.failure(error,stage:.networkBalance,status:CampusDiagnostics.issue(error).code == .loginRequired ? "login_required" : "unavailable") }
    }
    func part(_ part: String) async -> [String: [String: Any]] {
        switch part {
        case "card": return ["card":await cardWithReauthentication(balanceOnly:false)]
        case "net": return ["net":await networkWithDiagnostics(balanceOnly:false)]
        case "electricity": return await electricityData()
        default: return [:]
        }
    }
    func refresh(balanceOnly: Bool = false) async -> NativeDashboardSnapshot {
        async let power = electricityData()
        let card = await cardWithReauthentication(balanceOnly:balanceOnly)
        let net = await networkWithDiagnostics(balanceOnly:balanceOnly)
        let electricity = await power
        return NativeDashboardSnapshot(card:card, net:net,
            lighting:electricity["lighting"] ?? ["status":"unavailable"], air:electricity["air"] ?? ["status":"unavailable"])
    }
}
