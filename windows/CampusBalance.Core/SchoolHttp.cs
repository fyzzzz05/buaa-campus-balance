using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace CampusBalance.Core;

public sealed record SchoolResponse(string Text, Uri Url);

public static class SchoolPolicy
{
    public static readonly IReadOnlySet<string> Hosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "www.cc-pay.cn", "pass.cc-pay.cn", "mall.cc-pay.cn", "sso.buaa.edu.cn", "zfw.buaa.edu.cn" };
    public static bool Allowed(Uri url) => url.IsAbsoluteUri && url.Scheme == "https" && Hosts.Contains(url.Host) && PlainAuthority(url);
    public static bool PlainAuthority(Uri url) => string.IsNullOrEmpty(url.UserInfo) &&
        Regex.Match(url.OriginalString, @"\Ahttps?://([^/?#]+)", RegexOptions.IgnoreCase).Groups[1].Value.Equals(url.Host, StringComparison.OrdinalIgnoreCase);
    public static bool RedirectAllowed(Uri source, Uri target, int status, HttpMethod method) => Allowed(source) && Allowed(target) &&
        !(status is 307 or 308 && method != HttpMethod.Get && source.Host != target.Host);
    public static Uri Url(string endpoint, params (string Name, string Value)[] query) => new(endpoint + (query.Length == 0 ? "" : "?" +
        string.Join("&", query.Select(pair => Uri.EscapeDataString(pair.Name) + "=" + Uri.EscapeDataString(pair.Value)))));
}

public sealed class SchoolHttp : IDisposable
{
    private readonly HttpClient client;
    private readonly Func<Uri, bool> allowed;
    public CookieContainer Cookies { get; } = new();
    public SchoolHttp(Func<Uri, bool>? allowed = null, HttpMessageHandler? handler = null, bool useCookies = true)
    {
        this.allowed = allowed ?? SchoolPolicy.Allowed;
        client = new HttpClient(handler ?? new HttpClientHandler
        {
            AllowAutoRedirect = false, UseCookies = useCookies, CookieContainer = Cookies,
            AutomaticDecompression = DecompressionMethods.All
        }) { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CampusBalance/1.1.4");
    }

    public async Task<SchoolResponse> SendAsync(Uri uri, CancellationToken cancellationToken = default,
        HttpMethod? method = null, IReadOnlyDictionary<string, string>? fields = null, Uri? referer = null,
        TimeSpan? timeout = null, int limit = 3_000_000)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout ?? TimeSpan.FromSeconds(30));
        var verb = method ?? HttpMethod.Get;
        for (var redirects = 0; redirects <= 10; redirects++)
        {
            if (!allowed(uri)) throw new CampusException("REDIRECT_BLOCKED", "学校服务跳转异常");
            using var request = new HttpRequestMessage(verb, uri);
            request.Headers.Accept.ParseAdd("application/json, text/html;q=0.9, */*;q=0.8");
            if (referer is not null) request.Headers.Referrer = referer;
            if (fields is not null)
            {
                request.Content = new FormUrlEncodedContent(fields);
                request.Headers.TryAddWithoutValidation("Origin", "https://sso.buaa.edu.cn");
            }
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token).ConfigureAwait(false);
            var status = (int)response.StatusCode;
            if (status is >= 300 and < 400)
            {
                var location = response.Headers.Location;
                if (location is null) throw new CampusException("REDIRECT_BLOCKED", "学校服务跳转异常");
                var next = location.IsAbsoluteUri ? location : new Uri(uri, location);
                if (!allowed(next) || status is 307 or 308 && verb != HttpMethod.Get && next.Host != uri.Host)
                    throw new CampusException("REDIRECT_BLOCKED", "学校服务跳转异常");
                if (status == 303 || (status is 301 or 302 && verb == HttpMethod.Post)) { verb = HttpMethod.Get; fields = null; }
                if (next.Host != uri.Host) referer = null;
                uri = next;
                continue;
            }
            if (status == 401) throw CampusException.Login();
            if (status is < 200 or > 299) throw new CampusException("HTTP_ERROR", "学校服务返回错误", httpStatus: status);
            if (response.Content.Headers.ContentLength > limit) throw new CampusException("RESPONSE_TOO_LARGE", "学校响应超过大小限制");
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token).ConfigureAwait(false);
            using var memory = new MemoryStream();
            var buffer = new byte[16384];
            int size;
            while ((size = await stream.ReadAsync(buffer, deadline.Token).ConfigureAwait(false)) > 0)
            {
                if (memory.Length + size > limit) throw new CampusException("RESPONSE_TOO_LARGE", "学校响应超过大小限制");
                memory.Write(buffer, 0, size);
            }
            return new SchoolResponse(Encoding.UTF8.GetString(memory.ToArray()), uri);
        }
        throw new CampusException("REDIRECT_BLOCKED", "学校服务跳转异常");
    }
    public void Dispose() => client.Dispose();
}
