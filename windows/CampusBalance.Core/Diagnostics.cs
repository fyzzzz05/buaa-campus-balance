using System.Net.Http;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text.Json;

namespace CampusBalance.Core;

public sealed class CampusException(string code, string message, string? field = null, int? httpStatus = null) : Exception(message)
{
    public string Code { get; } = code;
    public string? Field { get; } = field;
    public int? HttpStatus { get; } = httpStatus;
    public static CampusException Invalid() => new("INVALID_RESPONSE", "学校响应格式异常");
    public static CampusException Login() => new("LOGIN_REQUIRED", "学校登录未完成或已失效，请重新登录");
    public static CampusException Incomplete() => new("HISTORY_INCOMPLETE", "学校流水分页不完整");
    public static CampusException From(Exception error)
    {
        if (error is CampusException known) return known;
        if (error is OperationCanceledException) return new("TIMEOUT", "学校服务请求超时");
        if (error is HttpRequestException http)
        {
            if (http.HttpRequestError == HttpRequestError.SecureConnectionError || http.InnerException is AuthenticationException)
                return new("TLS_FAILED", "学校 HTTPS 证书或握手失败");
            if (http.HttpRequestError == HttpRequestError.NameResolutionError ||
                http.InnerException is SocketException { SocketErrorCode: SocketError.HostNotFound })
                return new("DNS_FAILED", "学校域名解析失败");
            if (http.HttpRequestError == HttpRequestError.ConnectionError)
                return new("CONNECTION_FAILED", "无法连接学校服务");
        }
        if (error is JsonException or FormatException or OverflowException) return Invalid();
        return new("UNKNOWN", "查询失败，请重试");
    }
}

public sealed class Diagnostics(string directory)
{
    private readonly object gate = new();
    public string DirectoryPath => directory;
    private static readonly IReadOnlyDictionary<string, string> Endpoints = new Dictionary<string, string>
    {
        ["schoolLogin"] = "https://sso.buaa.edu.cn/login",
        ["cardBalance"] = "https://www.cc-pay.cn/api/campus_card/balance",
        ["cardHistory"] = "https://mall.cc-pay.cn/api/campus_card/trades",
        ["networkBalance"] = "https://zfw.buaa.edu.cn/home",
        ["networkAuth"] = "https://zfw.buaa.edu.cn/site/sso",
        ["networkHistory"] = "https://zfw.buaa.edu.cn/log/detail",
        ["lightingMeter"] = "https://shsd.buaa.edu.cn/PubBuaa",
        ["airMeter"] = "https://shsd.buaa.edu.cn/PubBuaa",
        ["electricityHistory"] = "https://raw.githubusercontent.com"
    };
    public void Report(Exception error, string stage, string scheme = "https")
    {
        var issue = CampusException.From(error);
        // Never serialize exception text, URLs from requests, account IDs, bodies or cookies.
        var endpoint = Endpoints.GetValueOrDefault(stage);
        if (scheme == "http" && stage is "lightingMeter" or "airMeter") endpoint = endpoint?.Replace("https:", "http:");
        var record = new { time = DateTimeOffset.UtcNow, code = issue.Code, stage, issue.Field, issue.HttpStatus, endpoint };
        lock (gate)
        {
            try
            {
                Directory.CreateDirectory(directory);
                var file = Path.Combine(directory, "diagnostics.ndjson");
                if (File.Exists(file) && new FileInfo(file).Length >= 262144) File.Move(file, file + ".1", true);
                File.AppendAllText(file, JsonSerializer.Serialize(record) + "\n");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
    }
}
