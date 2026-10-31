using System.Globalization;
using System.Text.Json.Nodes;

namespace CampusBalance.Core;

internal static class JsonValues
{
    public static JsonObject Object(string json) => JsonNode.Parse(json) as JsonObject ?? throw CampusException.Invalid();
    public static bool Success(JsonObject value) => value["success"]?.ToString() == "true";
    public static decimal Number(JsonNode? node) => decimal.TryParse(node?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
        ? value : throw CampusException.Invalid();
}

public sealed class CardHistory(IReadOnlyList<string> days)
{
    private readonly Dictionary<string, decimal> totals = days.ToDictionary(d => d, _ => 0m);
    private readonly List<CampusRecord> records = [];
    private int received;
    private int? expected;
    public bool Append(JsonObject body, int pageSize = 100)
    {
        if (!JsonValues.Success(body) || body["data"] is not JsonObject data || data["data"] is not JsonArray rows) throw CampusException.Invalid();
        if (int.TryParse(data["count"]?.ToString(), out var count) && count >= 0 && !(count == 0 && rows.Count > 0))
        {
            if (expected is not null && expected != count) throw CampusException.Incomplete();
            expected = count;
        }
        foreach (var row in rows)
        {
            var date = row?["date"]?.ToString() ?? "";
            var amount = JsonValues.Number(row?["amount"]);
            if (date.Length < 10 || !CampusDates.ValidDay(date[..10]) || amount != decimal.Truncate(amount)) throw CampusException.Invalid();
            var day = date[..10];
            if (amount < 0 && totals.ContainsKey(day))
            {
                totals[day] -= amount / 100;
                var label = row?["merName"]?.ToString() ?? row?["txName"]?.ToString() ?? "校园卡消费";
                records.Add(new CampusRecord(label[..Math.Min(label.Length, 100)], date, "¥" + (-amount / 100).ToString("0.00", CultureInfo.InvariantCulture)));
            }
        }
        received += rows.Count;
        if (expected is { } total)
        {
            if (received > total) throw CampusException.Invalid();
            if (received == total) return true;
            if (rows.Count == 0) throw CampusException.Incomplete();
            return false;
        }
        return rows.Count < pageSize;
    }
    public HistoryResult Result() => new(days.Select(d => new DayValue(d, totals[d])).ToArray(), records.ToArray());
}

public sealed class NetworkHistory(IReadOnlyList<string> days)
{
    private readonly Dictionary<string, decimal> totals = days.ToDictionary(d => d, _ => 0m);
    private readonly List<CampusRecord> records = [];
    private int received;
    private int? expected;
    public bool Append(NetworkPage page)
    {
        if (page.Total < 0 || expected is not null && page.Total != expected) throw CampusException.Invalid();
        expected = page.Total;
        if (page.Rows.Count == 0 && received < page.Total) throw CampusException.Incomplete();
        foreach (var row in page.Rows)
        {
            if (row.Date.Length < 10 || !CampusDates.ValidDay(row.Date[..10]) || row.Bytes < 0) throw CampusException.Invalid();
            var value = row.Bytes / 1073741824;
            if (totals.ContainsKey(row.Date[..10])) totals[row.Date[..10]] += value;
            if (records.Count < 100) records.Add(new CampusRecord("流量结算", row.Date, value.ToString("0.00", CultureInfo.InvariantCulture) + " GB"));
        }
        received += page.Rows.Count;
        if (received > page.Total) throw CampusException.Invalid();
        return received == page.Total;
    }
    public HistoryResult Result() => new(days.Select(d => new DayValue(d, totals[d])).ToArray(), records.ToArray());
}
