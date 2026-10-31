import Foundation

func check(_ condition: Bool, _ message: String) {
    guard condition else { fatalError(message) }
}
let day = "2026-10-28"
var card = CardTradeAccumulator(days: [day])
let complete = try card.appendPage(["success": true, "data": ["data": [
    ["date": day + " 12:00:00", "amount": -1733, "merName": "食堂"],
    ["date": day + " 13:00:00", "amount": 5000],
    ["date": day + " 14:00:00", "amount": -260]
], "count": 3]])
check(complete, "card completion")
check(card.result().history[0].value == 19.93, "card consumption excludes top-ups")
check(card.result().records.count == 2, "card records")
var noCount = CardTradeAccumulator(days: [day])
check((try noCount.appendPage(["success": true, "data": ["data": [["date": day + " 12:00:00", "amount": -100]], "count": 0]])), "zero count with rows")
var incomplete = CardTradeAccumulator(days: [day])
do { _ = try incomplete.appendPage(["success": true, "data": ["data": [], "count": 3]]); fatalError("expected incomplete page error") } catch {}
var network = NetworkHistoryAccumulator(days: [day])
check((try network.appendPage(total: 2, rows: [(date: day + " 04:30:00", bytes: 1_073_741_824)])) == false, "network pagination")
check((try network.appendPage(total: 2, rows: [(date: day + " 05:30:00", bytes: 2_147_483_648)])), "network completed")
check(network.result().history[0].value == 3, "network total")
print("Native history parsing tests passed")
let source = URL(string: "https://sso.buaa.edu.cn/login")!
var request = URLRequest(url: source)
request.httpMethod = "POST"
request.httpBody = Data("synthetic".utf8)
let forbidden = URLRequest(url: URL(string: "https://example.com/")!)
let differentSchool = URLRequest(url: URL(string: "https://www.cc-pay.cn/")!)
let sameSchool = URLRequest(url: URL(string: "https://sso.buaa.edu.cn/next")!)
let redirect = HTTPURLResponse(url: source, statusCode: 307, httpVersion: nil, headerFields: nil)!
check(!SchoolRedirectPolicy.redirectAllowed(from: request, response: redirect, to: forbidden), "reject unrelated host")
check(!SchoolRedirectPolicy.redirectAllowed(from: request, response: redirect, to: differentSchool), "reject credential body redirect")
check(SchoolRedirectPolicy.redirectAllowed(from: request, response: redirect, to: sameSchool), "allow same host")
check(!SchoolRedirectPolicy.allowed(URL(string: "http://sso.buaa.edu.cn/")!), "reject cleartext")
check(!SchoolRedirectPolicy.allowed(URL(string: "https://sso.buaa.edu.cn:443/")!), "reject explicit ports")
print("Native school redirect tests passed")
let html = "<table><thead><tr><th>已用流量</th><th>免费流量剩余</th><th>计费流量剩余</th></tr></thead><tbody><tr><td>35.774G</td><td>34.226G</td><td>40.000G</td></tr></tbody></table>"
check((try SchoolHTML.quota(html)) == NetworkQuota(free: 34.226, paid: 40, used: 35.774), "network quota")
let exhaustedQuotaHTML = "<table><tr><th>已用流量</th><th>免费流量剩余(不含套餐)</th><th>计费流量剩余(不含套餐)</th></tr><tr><td>70.000G</td><td>0byte</td><td>40.000G</td></tr></table>"
check((try SchoolHTML.quota(exhaustedQuotaHTML)) == NetworkQuota(free: 0, paid: 40, used: 70), "exhausted free quota in bytes")
for unit in ["B", "byte", "BYTES"] {
    let byteQuotaHTML = exhaustedQuotaHTML.replacingOccurrences(of: "0byte", with: "1073741824 " + unit)
    check((try SchoolHTML.quota(byteQuotaHTML)) == NetworkQuota(free: 1, paid: 40, used: 70), "byte quota converted to GB")
}
do { _ = try SchoolHTML.quota("登录 免费流量剩余"); fatalError("should reject missing quota table") } catch {}
let form = try SchoolHTML.loginForm("<form id='loginForm' action='login'><input name='execution' value='flow'><input name='type' value='username_password'></form>", at: URL(string: "https://sso.buaa.edu.cn/login")!)
check(form.fields["execution"] == "flow", "login form")
check(form.action.host == "sso.buaa.edu.cn", "login form host")
print("Native school HTML parsing tests passed")
let pageHTML = "<div class='summary'>第1-1条，共2条数据.</div><table><thead><tr><th>总流量</th></tr></thead><tbody><tr><td>start</td><td>2026-10-28 04:30:00(虚拟下线)</td><td>mac</td><td>ip</td><td>1,073,741,824</td><td>G</td></tr></tbody></table>"
let parsedPage = try SchoolHTML.networkPage(pageHTML)
check(parsedPage.total == 2 && parsedPage.rows.count == 1 && parsedPage.rows[0].bytes == 1_073_741_824, "network history page")
check(NativeSchoolClient.recentDays(count: 14).count == 14, "recent days")
print("Native page parsing tests passed")
let csv = "date,key,meter_id,remaining_cny\n2026-10-24,lighting,123,20\n2026-10-25,lighting,123,19\n2026-10-26,lighting,123,25\n2026-10-24,air_conditioner,456,10\n2026-10-25,air_conditioner,456,9.5\n2026-10-26,air_conditioner,456,9.2\n"
let electricity = try Electricity.history(csv, config: ElectricityConfig(lighting:"123", air:"456", historyOwner:"example"))
check(electricity["lighting"]?.value == 25 && electricity["air"]?.value == 9.2, "electricity balances")
check(electricity["lighting"]?.history.last?.value == nil, "recharge is not usage")
check(electricity["air"]?.history.last?.value == 0.3, "electricity daily usage")
let differentMeter = try Electricity.history(csv, config: ElectricityConfig(lighting:"999", air:"456", historyOwner:"example"))
check(differentMeter["lighting"] == nil && differentMeter["air"] != nil, "meter matching")
check((try Electricity.csv("a,b\n\"x,y\",\"a\"\"b\""))[1] == ["x,y", "a\"b"], "CSV quoting")
check((try Electricity.csv("a,b\r\nx,y\r\n")).count == 2, "CSV CRLF line endings")
print("Native electricity history tests passed")
let meterHTML = "<p>购电表号:123</p><p>地址:某楼[照明]</p><p>电价:0.5</p><p>截止 2026/10/27</p><svg id='canvas1'><text><tspan>20</tspan></text></svg>"
check((try Electricity.meter(meterHTML, id:"123", kind:"lighting")).value == 10, "live meter balance")
do { _ = try Electricity.meter(meterHTML, id:"123", kind:"air"); fatalError("wrong meter kind accepted") } catch {}
print("Native meter parsing tests passed")
let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory:true)
try FileManager.default.createDirectory(at:tempHome,withIntermediateDirectories:true)
defer { try? FileManager.default.removeItem(at:tempHome) }
let settings = DormSettings(dorm:"某楼", lighting:"123", air:"456", historyOwner:"example")
_ = try LocalSettings.write(user:"testuser", value:settings, home:tempHome)
check(LocalSettings.read(user:"testuser",home:tempHome) == settings, "settings round trip")
check(LocalSettings.read(user:"other",home:tempHome) != settings, "account isolation")
do { try DormSettings(dorm:"", lighting:"../../bad", air:"", historyOwner:"").validate(); fatalError("invalid meter accepted") } catch {}
print("Native settings tests passed")
let resource = URL(fileURLWithPath:"/tmp/widget-resources")
let refresh: [String:Any] = ["ProgramArguments":[resource.appendingPathComponent("CampusWidgetRefresh").path],"EnvironmentVariables":["CAMPUS_WIDGET_HELPER":resource.appendingPathComponent("CampusWidgetSnapshot").path],"RunAtLoad":true,"StartCalendarInterval":["Hour":8,"Minute":30]]
let bridge: [String:Any] = ["ProgramArguments":[resource.appendingPathComponent("CampusWidgetBridge").path,resource.appendingPathComponent("widget-token").path],"RunAtLoad":true,"KeepAlive":true]
let jobConfig: [String:Any] = ["user":"testuser","networkSamePassword":true]
check(WidgetAgents.matches(configValue:jobConfig,refresh:refresh,bridge:bridge,user:"testuser",same:true,resources:resource), "reuse matching agents")
check(!WidgetAgents.matches(configValue:jobConfig,refresh:refresh,bridge:bridge,user:"other",same:true,resources:resource), "different account must not reuse")
check(!WidgetAgents.matches(configValue:jobConfig,refresh:refresh,bridge:bridge,user:"testuser",same:false,resources:resource), "different network policy must not reuse")
print("Native agent reuse tests passed")
var batches = RefreshBatches()
let good: [String:Any] = ["status":"ok","value":42.0]
batches.begin("old");batches.begin("new")
check(batches.complete("new",values:["card":good,"net":good]) == nil, "do not publish partial snapshot")
check(batches.complete("old",values:["card":good,"net":good,"lighting":good,"air":good]) == nil, "stale snapshot must not publish")
check(batches.complete("new",values:["lighting":good,"air":good]) != nil, "publish newest complete snapshot")
batches.begin("logged-out");batches.reset()
check(batches.complete("logged-out",values:["card":good,"net":good,"lighting":good,"air":good]) == nil, "reset discards previous session")
print("Native refresh batching tests passed")

for (urlCode, expected) in [(NSURLErrorTimedOut, "TIMEOUT"), (NSURLErrorCannotConnectToHost, "CONNECTION_FAILED"), (NSURLErrorCannotFindHost, "DNS_FAILED"), (NSURLErrorServerCertificateUntrusted, "TLS_FAILED")] {
    let error = NSError(domain:NSURLErrorDomain,code:urlCode,userInfo:[NSLocalizedDescriptionKey:"secret-password-cookie", NSURLErrorFailingURLErrorKey:URL(string:"https://zfw.buaa.edu.cn/site/sso?data=secret")!])
    let diagnostic = CampusDiagnostics.describe(error,stage:.networkAuth)
    check(diagnostic["code"] as? String == expected, "native transport error category")
    let encoded = String(data:try JSONSerialization.data(withJSONObject:diagnostic),encoding:.utf8)!
    check(!encoded.contains("secret") && !encoded.contains("data="), "diagnostics omit credentials and full auth URLs")
}
do {
    _ = try SchoolHTML.quota(exhaustedQuotaHTML.replacingOccurrences(of:"0byte",with:"unknown"))
    fatalError("invalid quota accepted")
} catch {
    let issue = CampusDiagnostics.issue(error)
    check(issue.code == .quotaValueInvalid && issue.field == .free, "invalid quota unit diagnosed separately")
}
do { _ = try SchoolHTML.quota("<form id='login-form'></form>"); fatalError("login page accepted") }
catch { check(CampusDiagnostics.issue(error).code == .loginRequired, "recognize network login page") }
do { _ = try SchoolHTML.quota("<table><tr><td>new layout</td></tr></table>"); fatalError("missing table accepted") }
catch { check(CampusDiagnostics.issue(error).code == .quotaTableMissing, "recognize missing network table") }
do { _ = try Electricity.meter(meterHTML.replacingOccurrences(of:"电价:",with:"其他字段:"),id:"123",kind:"lighting"); fatalError("missing price accepted") }
catch { let issue = CampusDiagnostics.issue(error); check(issue.code == .fieldMissing && issue.field == .price, "missing price diagnosed separately") }
do { _ = try Electricity.meter(meterHTML,id:"456",kind:"lighting"); fatalError("wrong meter accepted") }
catch { check(CampusDiagnostics.issue(error).code == .meterIDMismatch, "meter identity mismatch") }
let logDir = tempHome.appendingPathComponent("diagnostics")
let logRecord = CampusDiagnostics.describe(CampusIssue(code:.http,httpStatus:503),stage:.lightingMeter)
CampusDiagnostics.write(logRecord,directory:logDir)
let logPath = logDir.appendingPathComponent("diagnostics.ndjson")
let filePermissions = try FileManager.default.attributesOfItem(atPath:logPath.path)[.posixPermissions] as? NSNumber
check(filePermissions?.intValue == 0o600, "private diagnostic permissions")
try Data(repeating:32,count:262144).write(to:logPath)
CampusDiagnostics.write(logRecord,directory:logDir)
check(FileManager.default.fileExists(atPath:logDir.appendingPathComponent("diagnostics.ndjson.1").path), "bounded diagnostic rotation")
let logData = try Data(contentsOf:logPath)
let logged = try JSONSerialization.jsonObject(with:logData) as! [String:Any]
check(logged["httpStatus"] as? Int == 503 && logged["stage"] as? String == "lightingMeter", "diagnostic record context")
print("Native diagnostic categorization and privacy tests passed")

let aliasedMeterHTML = meterHTML.replacingOccurrences(of:"地址:",with:"地哈哈址:").replacingOccurrences(of:"电价:",with:"电哈哈价:")
check((try Electricity.meter(aliasedMeterHTML,id:"123",kind:"lighting")).value == 10, "known school electricity field aliases")
final class MeterTestProtocol: URLProtocol {
    static var schemes: [String] = []
    static var secureFailure = NSURLErrorCannotConnectToHost
    static var fixture = ""
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        Self.schemes.append(url.scheme!)
        if url.scheme == "https" {
            client?.urlProtocol(self,didFailWithError:NSError(domain:NSURLErrorDomain,code:Self.secureFailure))
        } else {
            client?.urlProtocol(self,didReceive:HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:Data(Self.fixture.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
let meterConfiguration = URLSessionConfiguration.ephemeral
meterConfiguration.protocolClasses = [MeterTestProtocol.self]
let meterSession = URLSession(configuration:meterConfiguration)
MeterTestProtocol.fixture = aliasedMeterHTML
let fallbackReading = try await Electricity.fetchMeter(id:"123",kind:"lighting",session:meterSession)
check(MeterTestProtocol.schemes == ["https","http"], "HTTPS connection failure falls back to HTTP once")
check(fallbackReading.value == 10 && fallbackReading.note == "截至 2026-10-27", "HTTP details do not alter the balance date note")
check(Electricity.cutoffNote("[截止 2026/10/31 0:00:00]") == "截至 2026-10-31", "normalize school cutoff date")
check(Electricity.cutoffNote("截止 2026/2/30") == "学校电表", "reject invalid cutoff date")
check(fallbackReading.transportDiagnostic?["code"] as? String == "CONNECTION_FAILED", "HTTPS failure preserved on success")
MeterTestProtocol.schemes = []; MeterTestProtocol.secureFailure = NSURLErrorServerCertificateUntrusted
do { _ = try await Electricity.fetchMeter(id:"123",kind:"lighting",session:meterSession); fatalError("TLS failure accepted") }
catch { check(CampusDiagnostics.issue(error).code == .tls, "TLS failure preserved") }
check(MeterTestProtocol.schemes == ["https"], "do not downgrade after certificate failures")
meterSession.invalidateAndCancel()
print("Native electricity fallback tests passed")
