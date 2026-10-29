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
