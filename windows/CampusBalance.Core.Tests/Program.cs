using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using CampusBalance.Core;

var passed = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAIL: " + name);
    passed++; Console.WriteLine("PASS: " + name);
}
void Reject(Action action, string code, string name)
{
    try { action(); } catch (CampusException ex) { Check(ex.Code == code, name); return; }
    throw new Exception("FAIL: " + name);
}
async Task RejectAsync(Func<Task> action, string code, string name)
{
    try { await action(); } catch (Exception ex) { Check(CampusException.From(ex).Code == code, name); return; }
    throw new Exception("FAIL: " + name);
}
var root = Path.Combine(Path.GetTempPath(), "campus-windows-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    const string day = "2026-10-28";
    var card = new CardHistory([day]);
    Check(card.Append(JsonNode.Parse("""
        {"success":true,"data":{"count":3,"data":[
          {"date":"2026-10-28 12:00:00","amount":-1733,"merName":"食堂"},
          {"date":"2026-10-28 13:00:00","amount":5000},
          {"date":"2026-10-28 14:00:00","amount":-260}]}}
        """)!.AsObject()), "card complete pagination");
    Check(card.Result().Days[0].Value == 19.93m && card.Result().Records.Count == 2, "card cents and exclusion of top-ups");
    Reject(() => new CardHistory([day]).Append(JsonNode.Parse("""{"success":true,"data":{"count":3,"data":[]}}""")!.AsObject()), "HISTORY_INCOMPLETE", "incomplete card history is rejected");
    var zeroCount = new CardHistory([day]);
    Check(zeroCount.Append(JsonNode.Parse("""{"success":true,"data":{"count":0,"data":[{"date":"2026-10-28 12:00:00","amount":-100}]}}""")!.AsObject()), "school zero count with rows");
    var changing = new CardHistory([day]);
    Check(!changing.Append(JsonNode.Parse("""{"success":true,"data":{"count":2,"data":[{"date":"2026-10-28 12:00:00","amount":-100}]}}""")!.AsObject()), "card first page");
    Reject(() => changing.Append(JsonNode.Parse("""{"success":true,"data":{"count":3,"data":[]}}""")!.AsObject()), "HISTORY_INCOMPLETE", "changing totals reject partial history");
    var network = new NetworkHistory([day]);
    Check(!network.Append(new NetworkPage(2, [new NetworkRow(day + " 04:30:00", 1073741824)])), "network first page");
    Check(network.Append(new NetworkPage(2, [new NetworkRow(day + " 05:30:00", 2147483648)])) && network.Result().Days[0].Value == 3, "network settlement totals");
    Reject(() => new NetworkHistory([day]).Append(new NetworkPage(1, [])), "HISTORY_INCOMPLETE", "incomplete network page rejected");

    const string quota = "<table><tr><th>已用流量</th><th>免费流量剩余(不含套餐)</th><th>计费流量剩余</th></tr><tr><td>70.000G</td><td>0byte</td><td>40.000G</td></tr></table>";
    Check(SchoolHtml.Quota(quota) == new NetworkQuota(0, 40, 70), "v1.1.4 exhausted quota in bytes");
    foreach (var unit in new[] { "B", "byte", "BYTES" }) Check(SchoolHtml.QuotaValue("1073741824 " + unit) == 1, "quota unit " + unit);
    Check(SchoolHtml.QuotaValue("1024 MB") == 1 && SchoolHtml.QuotaValue("1T") == 1024, "quota unit conversion");
    Reject(() => SchoolHtml.Quota(quota.Replace("0byte", "unknown")), "QUOTA_VALUE_INVALID", "unknown units rejected");
    Reject(() => SchoolHtml.Quota("<form id='login-form'></form>"), "LOGIN_REQUIRED", "network login page detected");
    Reject(() => SchoolHtml.Quota("<table><tr><td>new layout</td></tr></table>"), "QUOTA_TABLE_MISSING", "missing quota table detected");
    var form = SchoolHtml.ParseLogin("<form id='loginForm' action='login'><input name='execution' value='a&amp;b'><input name='type' value='username_password'><input name='unexpected' value='ignored'></form>", new Uri("https://sso.buaa.edu.cn/login"));
    Check(form.Action.Host == "sso.buaa.edu.cn" && form.Fields["execution"] == "a&b" && form.Fields.Count == 2, "login form decodes entities and filters fields");
    Reject(() => SchoolHtml.ParseLogin("<form id='loginForm' action='https://example.com'><input name='execution' value='x'></form>", new Uri("https://sso.buaa.edu.cn/login")), "INVALID_RESPONSE", "login form cannot send credentials to another host");
    const string networkPage = "<div class='summary'>第1-1条，共2条数据.</div><table><thead><tr><th>总流量</th></tr></thead><tbody><tr><td>start</td><td>2026-10-28 04:30:00(虚拟下线)</td><td>mac</td><td>ip</td><td>1,073,741,824</td><td>G</td></tr></tbody></table>";
    Check(SchoolHtml.NetworkHistory(networkPage) is { Total: 2, Rows.Count: 1 } parsed && parsed.Rows[0].Bytes == 1073741824, "network HTML detail page");

    const string meter = "<p>购电表号:123</p><p>地哈哈址:某楼[照明]</p><p>电哈哈价:0.5</p><p>[截止 2026/10/31 0:00:00]</p><svg id='canvas1'><text><tspan>20</tspan></text></svg>";
    var meterReading = ElectricityParser.Meter(meter, "123", Metric.Lighting);
    Check(meterReading.Value == 10 && meterReading.Note == "截至 2026-10-31", "v1.1.4 aliased fields and concise cutoff date");
    Check(ElectricityParser.CutoffNote("截止 2026/2/30") == "学校电表", "invalid cutoff dates rejected");
    Reject(() => ElectricityParser.Meter(meter, "456", Metric.Lighting), "METER_ID_MISMATCH", "meter identity verified");
    Reject(() => ElectricityParser.Meter(meter, "123", Metric.Air), "METER_KIND_MISMATCH", "meter kind verified");
    Reject(() => ElectricityParser.Meter(meter.Replace("电哈哈价:", "其他:"), "123", Metric.Lighting), "FIELD_MISSING", "missing meter price detected");
    const string csv = "date,key,meter_id,remaining_cny\r\n2026-10-24,lighting,123,20\r\n2026-10-25,lighting,123,19\r\n2026-10-26,lighting,123,25\r\n2026-10-24,air_conditioner,456,10\r\n2026-10-25,air_conditioner,456,9.5\r\n2026-10-26,air_conditioner,456,9.2\r\n";
    var settings = new DormSettings("某楼", "123", "456", "example");
    var history = ElectricityParser.History(csv, settings);
    Check(history[Metric.Lighting].Value == 25 && history[Metric.Air].Value == 9.2m, "electricity CSV balances");
    Check(history[Metric.Lighting].History[^1].Value is null && history[Metric.Air].History[^1].Value == 0.3m, "top-ups and gaps are not consumption");
    Check(!ElectricityParser.History(csv, settings with { Lighting = "999" }).ContainsKey(Metric.Lighting), "history requires matching meter IDs");
    Check(ElectricityParser.Csv("a,b\n\"x,y\",\"a\"\"b\"")[1].SequenceEqual(new[] { "x,y", "a\"b" }), "RFC4180 quotes and commas");
    Reject(() => ElectricityParser.Csv("a,b\n\"unterminated"), "INVALID_RESPONSE", "unterminated CSV rejected");

    var store = new LocalStore(root);
    store.SaveSettings("testuser", settings);
    Check(store.ReadSettings("testuser") == settings && store.ReadSettings("other") != settings, "settings persist and isolate accounts");
    Reject(() => store.SaveSettings("testuser", settings with { Lighting = "../bad" }), "INVALID_SETTINGS", "invalid settings rejected");
    var earlier = DateOnly.ParseExact("2026-10-27", "yyyy-MM-dd");
    store.CaptureCard("testuser", 20, earlier);
    Check(store.CaptureCard("testuser", 18.5m, earlier.AddDays(1)).Days[^1].Value == 1.5m, "card fallback estimates adjacent balance decrease");
    Check(store.CaptureCard("other", 18.5m, earlier.AddDays(1)).Days[^1].Value is null, "card history isolates accounts");
    Check(CampusDates.Today(DateTimeOffset.Parse("2026-10-30T17:00:00Z")) == new DateOnly(2026, 10, 31), "school dates use UTC+8");
    Check(!SchoolPolicy.Allowed(new Uri("http://sso.buaa.edu.cn/login")) && !SchoolPolicy.Allowed(new Uri("https://sso.buaa.edu.cn:443/login")) &&
        !SchoolPolicy.Allowed(new Uri("https://sso.buaa.edu.cn@evil.example/login")), "HTTPS allowlist rejects ports and credentials");

    var requests = new List<Uri>();
    using (var http = new SchoolHttp(handler: new FakeHandler(request =>
    {
        requests.Add(request.RequestUri!);
        return new HttpResponseMessage(HttpStatusCode.TemporaryRedirect) { Headers = { Location = new Uri("https://www.cc-pay.cn/next") } };
    })))
    {
        await RejectAsync(() => http.SendAsync(new Uri("https://sso.buaa.edu.cn/login"), method: HttpMethod.Post,
            fields: new Dictionary<string, string> { ["password"] = "synthetic-secret" }), "REDIRECT_BLOCKED", "307 cannot forward credentials across hosts");
        Check(requests.Count == 1, "blocked redirect performs no second request");
    }
    using (var http = new SchoolHttp(handler: new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://evil.example/") } })))
        await RejectAsync(() => http.SendAsync(new Uri(SchoolClient.LoginUrl)), "REDIRECT_BLOCKED", "external GET redirect blocked");
    using (var http = new SchoolHttp(handler: new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(new string('x', 100)) })))
        await RejectAsync(() => http.SendAsync(new Uri(SchoolClient.LoginUrl), limit: 10), "RESPONSE_TOO_LARGE", "response size is bounded");

    var diagnostics = new Diagnostics(Path.Combine(root, "Logs"));
    var schemes = new List<string>();
    var electricity = new ElectricityClient(diagnostics, () => new FakeHandler(request =>
    {
        schemes.Add(request.RequestUri!.Scheme);
        if (request.RequestUri.Scheme == "https") throw new HttpRequestException(HttpRequestError.ConnectionError, "synthetic-secret");
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(meter) };
    }));
    var fallback = await electricity.MeterAsync("123", Metric.Lighting, CancellationToken.None);
    Check(schemes.SequenceEqual(new[] { "https", "http" }) && fallback.Value == 10 && fallback.Note == "截至 2026-10-31", "HTTP retry preserves v1.1.4 normal date copy");
    schemes.Clear();
    var secureFailure = new ElectricityClient(diagnostics, () => new FakeHandler(request =>
    {
        schemes.Add(request.RequestUri!.Scheme); throw new HttpRequestException(HttpRequestError.SecureConnectionError, "synthetic-secret");
    }));
    await RejectAsync(() => secureFailure.MeterAsync("123", Metric.Lighting, CancellationToken.None), "TLS_FAILED", "TLS failure is not downgraded to HTTP");
    Check(schemes.SequenceEqual(new[] { "https" }), "TLS failure performs one request");
    var logFile = Path.Combine(diagnostics.DirectoryPath, "diagnostics.ndjson");
    Check(!File.ReadAllText(logFile).Contains("synthetic-secret") && !File.ReadAllText(logFile).Contains("?id="), "diagnostics omit credentials and query values");
    File.WriteAllText(logFile, new string(' ', 262144)); diagnostics.Report(CampusException.Invalid(), "cardBalance");
    Check(File.Exists(logFile + ".1"), "diagnostic rotation is bounded");

    // Exercise the real login/request pipeline with deterministic school responses, including '+' passwords.
    var loginRequests = new List<string>();
    using var loginHttp = new SchoolHttp(handler: new AsyncFakeHandler(async request =>
    {
        loginRequests.Add(request.RequestUri!.Host + request.RequestUri.AbsolutePath);
        if (request.RequestUri.Host == "www.cc-pay.cn" && request.RequestUri.AbsolutePath == "/login")
            return new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://sso.buaa.edu.cn/login") } };
        if (request.RequestUri.Host == "sso.buaa.edu.cn" && request.Method == HttpMethod.Get)
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<form id='loginForm'><input name='execution' value='flow'></form>") };
        if (request.Method == HttpMethod.Post)
        {
            var body = await request.Content!.ReadAsStringAsync();
            Check(body.Contains("password=a%2Bb%26c") && body.Contains("execution=flow"), "form encoding preserves plus and ampersand");
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("ok") };
        }
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"success":true,"data":{}}""") };
    }));
    using var school = new SchoolClient(loginHttp);
    var session = await school.LoginAsync("testuser", "a+b&c", true, CancellationToken.None);
    Check(session.User == "testuser" && session.NetworkDigest?.Length == 32 && loginRequests.Count == 4, "end-to-end credential login with protocol digest");

    var captured = new CapturedProgress();
    var serviceStore = new LocalStore(Path.Combine(root, "service"));
    var vaultForRenewal = new MemoryCredentials(new SavedLogin("testuser", "a+b&c", true));
    var replacementCount = 0;
    SchoolClient RenewedClient()
    {
        replacementCount++;
        return new SchoolClient(new SchoolHttp(handler: new FakeHandler(request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            var text = path switch
            {
                "/login" when request.RequestUri.Host == "sso.buaa.edu.cn" && request.Method == HttpMethod.Get => "<form id='loginForm'><input name='execution' value='flow'></form>",
                "/api/user" => """{"success":true,"data":{}}""",
                "/api/campus_cards" => """{"success":true,"data":[{"stuNo":"testuser"}]}""",
                "/api/campus_card/balance" => """{"success":true,"data":{"balance":42.5}}""",
                "/home" => quota,
                "/log/detail" => "<div class='summary'>共0条</div><table><tr><th>总流量</th></tr><tbody></tbody></table>",
                _ => "ok"
            };
            if (path == "/login" && request.RequestUri.Host == "www.cc-pay.cn")
                return new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://sso.buaa.edu.cn/login") } };
            return new HttpResponseMessage(path == "/api/campus_card/trades" ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK) { Content = new StringContent(text) };
        })));
    }
    var expired = new SchoolClient(new SchoolHttp(handler: new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized))));
    using (var service = new DashboardService(expired, session, serviceStore, diagnostics, vaultForRenewal, true, RenewedClient))
        await service.RefreshAsync(captured, CancellationToken.None);
    Check(replacementCount == 1 && vaultForRenewal.Reads == 1, "expired card session renews once with opted-in credentials");
    Check(captured.Last(Metric.Card).Value == 42.5m && captured.Last(Metric.Card).Status == ReadingStatus.Ok, "history failure retains successful card balance");
    Check(captured.Last(Metric.Card).HistoryNote == "余额减少估算 · 元", "history failure uses labelled local estimate");
    Check(captured.Last(Metric.Network).Value == 40 && captured.Last(Metric.Network).History?.Count == 14, "network uses renewed session and completes independently");
    Check(captured.Last(Metric.Air).Note == "请先设置宿舍电表", "unconfigured meters do not query school services");

    var noConsent = new CapturedProgress();
    var privateStore = new LocalStore(Path.Combine(root, "no-consent"));
    using (var service = new DashboardService(new SchoolClient(new SchoolHttp(handler: new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized)))),
        session, privateStore, diagnostics, vaultForRenewal, false, RenewedClient))
        await service.RefreshAsync(noConsent, CancellationToken.None);
    Check(replacementCount == 1 && noConsent.Last(Metric.Card).Status == ReadingStatus.LoginRequired, "no automatic credential use without consent");
    Check(!Directory.Exists(Path.Combine(privateStore.Root, "users")), "expired login is never turned into a balance estimate");

    using var cancel = new CancellationTokenSource();
    var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    using (var service = new DashboardService(new SchoolClient(new SchoolHttp(handler: new CancellableHandler(started))),
        session, privateStore, diagnostics, vaultForRenewal, false))
    {
        var pending = service.RefreshAsync(new CapturedProgress(), cancel.Token);
        await started.Task; cancel.Cancel();
        await RejectAsync(() => pending, "TIMEOUT", "cancelled refresh terminates all school tasks");
        Check(pending.IsCanceled, "caller cancellation remains cancellation rather than a failed balance");
    }

    if (OperatingSystem.IsWindows())
    {
        var vault = new CampusBalance.App.CredentialStore(root);
        var saved = new SavedLogin("testuser", "synthetic-secret-password", true);
        vault.Save(saved);
        Check(vault.Read() == saved, "Windows DPAPI credentials round trip");
        Check(!Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(root, "login.dpapi"))).Contains(saved.Password), "credentials on disk contain no plaintext password");
        vault.Clear(); Check(vault.Read() is null, "logout removes encrypted credentials");
    }
    else Console.WriteLine("SKIP: Windows DPAPI runtime checks (requires Windows)");
    Console.WriteLine($"{passed} checks passed.");
}
finally { Directory.Delete(root, true); }

sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> callback) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(callback(request));
}
sealed class AsyncFakeHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> callback) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => callback(request);
}
sealed class CapturedProgress : IProgress<BalanceReading>
{
    private readonly List<BalanceReading> readings = [];
    public void Report(BalanceReading value) { lock (readings) readings.Add(value); }
    public BalanceReading Last(Metric metric) { lock (readings) return readings.Last(r => r.Metric == metric); }
}
sealed class MemoryCredentials(SavedLogin saved) : ICredentialStore
{
    public int Reads { get; private set; }
    public SavedLogin? Read() { Reads++; return saved; }
    public void Save(SavedLogin login) => throw new NotSupportedException();
    public void Clear() => throw new NotSupportedException();
}
sealed class CancellableHandler(TaskCompletionSource started) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    { started.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); return new HttpResponseMessage(HttpStatusCode.OK); }
}
