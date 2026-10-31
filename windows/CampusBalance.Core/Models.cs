using System.Globalization;
using System.Text.RegularExpressions;

namespace CampusBalance.Core;

public sealed record SchoolSession(string User, string? NetworkDigest);
public sealed record DayValue(string Date, decimal? Value);
public sealed record CampusRecord(string Label, string Date, string Value);
public sealed record HistoryResult(IReadOnlyList<DayValue> Days, IReadOnlyList<CampusRecord> Records);
public sealed record NetworkQuota(decimal Free, decimal Paid, decimal Used);
public sealed record MeterReading(decimal Value, string Note, IReadOnlyList<DayValue> History);
public enum Metric { Card, Network, Lighting, Air }
public enum ReadingStatus { Loading, Ok, Unavailable, LoginRequired }

public sealed record BalanceReading(
    Metric Metric, ReadingStatus Status, decimal? Value = null, string Note = "正在查询",
    string HistoryNote = "近 14 天", IReadOnlyList<DayValue>? History = null,
    IReadOnlyList<CampusRecord>? Records = null, DateTimeOffset? UpdatedAt = null)
{
    public string Name => Metric switch
    {
        Metric.Card => "校园卡余额", Metric.Network => "校园网流量余额",
        Metric.Lighting => "照明电费余额", _ => "空调电费余额"
    };
    public string Unit => Metric == Metric.Network ? "GB" : "元";
    public string DisplayValue => Value?.ToString("0.00", CultureInfo.InvariantCulture) ?? "—";
    public string Summary => $"{DisplayValue} {Unit}";
    public static BalanceReading Failure(Metric metric, Exception error) => new(metric,
        CampusException.From(error).Code == "LOGIN_REQUIRED" ? ReadingStatus.LoginRequired : ReadingStatus.Unavailable,
        Note: CampusException.From(error).Message);
}

public sealed record DormSettings(string Dorm = "", string Lighting = "", string Air = "", string HistoryOwner = "")
{
    public DormSettings Validate()
    {
        var value = new DormSettings(Dorm.Trim(), Lighting.Trim(), Air.Trim(), HistoryOwner.Trim());
        if (value.Dorm.Length > 60 || value.Dorm.Any(char.IsControl) ||
            !Regex.IsMatch(value.Lighting, @"\A[0-9]{0,30}\z") ||
            !Regex.IsMatch(value.Air, @"\A[0-9]{0,30}\z") ||
            !Regex.IsMatch(value.HistoryOwner, @"\A(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)?\z"))
            throw new CampusException("INVALID_SETTINGS", "请检查电表号和 GitHub 用户名");
        return value;
    }
}

public static class CampusDates
{
    // School accounting dates always use China Standard Time, including on overseas PCs.
    public static DateOnly Today(DateTimeOffset? now = null) => DateOnly.FromDateTime((now ?? DateTimeOffset.UtcNow).ToOffset(TimeSpan.FromHours(8)).DateTime);
    public static string[] Recent(int count = 14, DateOnly? ending = null) =>
        Enumerable.Range(0, count).Select(i => (ending ?? Today()).AddDays(i - count + 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToArray();
    public static bool ValidDay(string date) => DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    public static IReadOnlyList<DayValue> Differences(IReadOnlyDictionary<string, decimal> balances, DateOnly ending) =>
        Recent(15, ending).Skip(1).Select(day =>
        {
            var previous = DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            decimal? difference = balances.TryGetValue(previous, out var before) && balances.TryGetValue(day, out var after) && before >= after
                ? decimal.Round(before - after, 2, MidpointRounding.AwayFromZero) : null;
            return new DayValue(day, difference);
        }).ToArray();
}
