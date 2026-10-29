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
            if let fallback = try? CardFallback.capture(value:value,user:current.user) {
                data["history"] = encodeHistory(fallback.history); data["records"] = encodeRecords(fallback.records)
                data["historyNote"] = "余额减少估算 · 流水暂不可用"; data["emptyNote"] = "暂无消费明细"
            } else { data["historyNote"] = "消费流水暂不可用" }
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
        } catch { data["historyNote"] = "流水暂不可用" }
        return data
    }
    private func electricityData() async -> [String: [String: Any]] {
        let settings = LocalSettings.read(user: current.user)
        let config = ElectricityConfig(lighting:settings.lighting, air:settings.air, historyOwner:settings.historyOwner)
        async let historyRequest = try? Electricity.fetchHistory(config:config)
        async let lightingRequest = config.lighting.isEmpty ? nil : try? Electricity.fetchMeter(id:config.lighting,kind:"lighting")
        async let airRequest = config.air.isEmpty ? nil : try? Electricity.fetchMeter(id:config.air,kind:"air")
        let (loadedHistory, lighting, air) = await (historyRequest, lightingRequest, airRequest)
        let history = loadedHistory ?? [:]
        var result: [String: [String: Any]] = [:]
        for (kind, id, live) in [("lighting",config.lighting,lighting),("air",config.air,air)] {
            guard !id.isEmpty else { result[kind] = ["status":"unavailable", "note":"请先设置宿舍电表"]; continue }
            if let value = live ?? history[kind] {
                let old = history[kind]
                result[kind] = ["status":"ok", "value":value.value, "unit":"元", "note":value.note,
                    "history":encodeHistory(old?.history ?? []), "historyNote":old == nil ? "暂无历史数据" : "余额减少估算 · 元"]
            } else { result[kind] = ["status":"unavailable", "note":"电表暂不可用"] }
        }
        return result
    }
    private func cardWithReauthentication(balanceOnly: Bool) async -> [String: Any] {
        do { return try await cardData(balanceOnly:balanceOnly) }
        catch {
            if autoLogin, let password = try? CampusKeychain.read(user:current.user) {
                let newClient = NativeSchoolClient()
                if let renewed = try? await newClient.login(user:current.user,password:password,networkSamePassword:current.networkDigest != nil) {
                    self.client = newClient; self.current = renewed
                    return (try? await cardData(balanceOnly:balanceOnly)) ?? ["status":"login_required","note":"自动登录失败，请重新登录"]
                }
                return ["status":"login_required","note":"自动登录失败，请重新登录"]
            }
            return ["status":"unavailable","note":"饭卡查询暂不可用"]
        }
    }
    func part(_ part: String) async -> [String: [String: Any]] {
        switch part {
        case "card": return ["card":await cardWithReauthentication(balanceOnly:false)]
        case "net": return ["net":(try? await networkData()) ?? ["status":"unavailable", "note":"校园网查询暂不可用"]]
        case "electricity": return await electricityData()
        default: return [:]
        }
    }
    func refresh(balanceOnly: Bool = false) async -> NativeDashboardSnapshot {
        async let power = electricityData()
        let card = await cardWithReauthentication(balanceOnly:balanceOnly)
        let net = (try? await networkData(balanceOnly:balanceOnly)) ?? ["status":"unavailable", "note":"校园网查询暂不可用"]
        let electricity = await power
        return NativeDashboardSnapshot(card:card, net:net,
            lighting:electricity["lighting"] ?? ["status":"unavailable"], air:electricity["air"] ?? ["status":"unavailable"])
    }
}
