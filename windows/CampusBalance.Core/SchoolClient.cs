using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CampusBalance.Core;

public sealed class SchoolClient(SchoolHttp? transport = null) : IDisposable
{
    private readonly SchoolHttp http = transport ?? new SchoolHttp();
    public const string LoginUrl = "https://www.cc-pay.cn/login?channel=BUAASSO";
    private async Task<JsonObject> JsonAsync(Uri uri, CancellationToken token, Uri? referer = null) =>
        JsonValues.Object((await http.SendAsync(uri, token, referer: referer).ConfigureAwait(false)).Text);

    public async Task<SchoolSession> LoginAsync(string user, string password, bool networkSamePassword, CancellationToken token)
    {
        if (!Regex.IsMatch(user, @"\A[A-Za-z0-9][A-Za-z0-9@._-]{1,64}\z") || string.IsNullOrEmpty(password) || Encoding.UTF8.GetByteCount(password) > 1024)
            throw new CampusException("LOGIN_REQUIRED", "请输入学号或工号，以及密码。");
        var response = await http.SendAsync(new Uri(LoginUrl), token).ConfigureAwait(false);
        var form = SchoolHtml.ParseLogin(response.Text, response.Url);
        form.Fields["username"] = user; form.Fields["password"] = password; form.Fields["submit"] = "LOGIN";
        await http.SendAsync(form.Action, token, HttpMethod.Post, form.Fields, response.Url).ConfigureAwait(false);
        var profile = await JsonAsync(new Uri("https://www.cc-pay.cn/api/user"), token).ConfigureAwait(false);
        if (!JsonValues.Success(profile) || profile["data"] is not JsonObject) throw CampusException.Login();
        // This legacy digest is required by the school's network SSO protocol; it is never persisted.
        var digest = networkSamePassword ? Convert.ToHexStringLower(MD5.HashData(Encoding.UTF8.GetBytes(password))) : null;
        return new SchoolSession(user, digest);
    }

    public async Task<SchoolSession> LoginWithCookiesAsync(IEnumerable<System.Net.Cookie> cookies, CancellationToken token)
    {
        var values = cookies.Take(81).ToArray();
        if (values.Length > 80) throw CampusException.Invalid();
        foreach (var cookie in values)
        {
            var host = cookie.Domain.TrimStart('.').ToLowerInvariant();
            if (host != "cc-pay.cn" && !SchoolPolicy.Hosts.Contains(host) || host == "zfw.buaa.edu.cn") continue;
            if (cookie.Value.Length > 4096 || cookie.Value.IndexOfAny(['\r', '\n', ';']) >= 0 || !cookie.Path.StartsWith('/')) continue;
            try { http.Cookies.Add(new System.Net.Cookie(cookie.Name, cookie.Value, cookie.Path, cookie.Domain) { Secure = true, HttpOnly = cookie.HttpOnly }); }
            catch (System.Net.CookieException) { }
        }
        var profile = await JsonAsync(new Uri("https://www.cc-pay.cn/api/user"), token).ConfigureAwait(false);
        if (!JsonValues.Success(profile))
        {
            await http.SendAsync(new Uri(LoginUrl), token).ConfigureAwait(false);
            profile = await JsonAsync(new Uri("https://www.cc-pay.cn/api/user"), token).ConfigureAwait(false);
        }
        if (!JsonValues.Success(profile)) throw CampusException.Login();
        var cards = await CardsAsync(token).ConfigureAwait(false);
        var data = profile["data"];
        var user = cards.FirstOrDefault()?["stuNo"]?.ToString() ?? data?["stuNo"]?.ToString() ?? data?["userName"]?.ToString() ?? data?["username"]?.ToString() ?? data?["account"]?.ToString();
        if (user is null || !Regex.IsMatch(user, @"\A[A-Za-z0-9][A-Za-z0-9@._-]{1,64}\z")) throw CampusException.Invalid();
        return new SchoolSession(user, null);
    }
    private async Task<JsonArray> CardsAsync(CancellationToken token)
    {
        var cards = await JsonAsync(new Uri("https://www.cc-pay.cn/api/campus_cards"), token).ConfigureAwait(false);
        if (!JsonValues.Success(cards))
        {
            await http.SendAsync(new Uri(LoginUrl), token).ConfigureAwait(false);
            cards = await JsonAsync(new Uri("https://www.cc-pay.cn/api/campus_cards"), token).ConfigureAwait(false);
        }
        if (!JsonValues.Success(cards)) throw CampusException.Login();
        if (cards["data"] is JsonArray list) return list;
        var nested = cards["data"] as JsonObject;
        return nested?["data"] as JsonArray ?? nested?["list"] as JsonArray ?? nested?["records"] as JsonArray ?? [];
    }
    public async Task<(decimal Value, string Number)> CardBalanceAsync(SchoolSession session, CancellationToken token)
    {
        var cards = await CardsAsync(token).ConfigureAwait(false);
        var number = cards.FirstOrDefault()?["stuNo"]?.ToString() ?? session.User;
        var body = await JsonAsync(SchoolPolicy.Url("https://www.cc-pay.cn/api/campus_card/balance", ("stuNo", number)), token).ConfigureAwait(false);
        if (!JsonValues.Success(body)) throw CampusException.Login();
        return (JsonValues.Number(body["data"]?["balance"]), number);
    }
    public async Task<NetworkQuota> NetworkBalanceAsync(SchoolSession session, CancellationToken token)
    {
        if (session.NetworkDigest is null) throw new CampusException("NETWORK_NOT_CONFIGURED", "未启用校园网登录，请使用账号密码登录并勾选相同密码");
        async Task<NetworkQuota> ReadAsync()
        {
            var result = await http.SendAsync(new Uri("https://zfw.buaa.edu.cn/home"), token).ConfigureAwait(false);
            if (result.Url.AbsolutePath == "/login") throw CampusException.Login();
            return SchoolHtml.Quota(result.Text);
        }
        try { return await ReadAsync().ConfigureAwait(false); }
        catch (CampusException ex) when (ex.Code == "LOGIN_REQUIRED") { }
        var data = Convert.ToBase64String(Encoding.UTF8.GetBytes($"zh-CN:{session.User}:{session.NetworkDigest}"));
        await http.SendAsync(SchoolPolicy.Url("https://zfw.buaa.edu.cn/site/sso", ("data", data)), token).ConfigureAwait(false);
        return await ReadAsync().ConfigureAwait(false);
    }
    public async Task<HistoryResult> CardHistoryAsync(string number, CancellationToken token)
    {
        var days = CampusDates.Recent();
        string Timestamp(string day, int addDays = 0) => new DateTimeOffset(DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(addDays).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(8))
            .ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        var history = new CardHistory(days);
        for (var page = 1; page <= 20; page++)
        {
            var url = SchoolPolicy.Url("https://mall.cc-pay.cn/api/campus_card/trades", ("t", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture)),
                ("pageSize", "100"), ("pageNum", page.ToString(CultureInfo.InvariantCulture)), ("minTsCreation", Timestamp(days[0])),
                ("maxTsCreation", Timestamp(days[^1], 1)), ("tradeType", "all"), ("stuNo", number));
            var referer = SchoolPolicy.Url("https://mall.cc-pay.cn/cardInquiry", ("stuNo", number), ("linkfrom", "pass"));
            if (history.Append(await JsonAsync(url, token, referer).ConfigureAwait(false))) return history.Result();
        }
        throw CampusException.Incomplete();
    }
    public async Task<HistoryResult> NetworkHistoryAsync(CancellationToken token)
    {
        var days = CampusDates.Recent();
        var history = new NetworkHistory(days);
        for (var page = 1; page <= 50; page++)
        {
            var url = SchoolPolicy.Url("https://zfw.buaa.edu.cn/log/detail", ("DetailLogSearch[start_time]", days[0] + " 00:00:00"),
                ("DetailLogSearch[end_time]", days[^1] + " 23:59:59"), ("page", page.ToString(CultureInfo.InvariantCulture)));
            var response = await http.SendAsync(url, token).ConfigureAwait(false);
            if (history.Append(SchoolHtml.NetworkHistory(response.Text))) return history.Result();
        }
        throw CampusException.Incomplete();
    }
    public void Dispose() => http.Dispose();
}
