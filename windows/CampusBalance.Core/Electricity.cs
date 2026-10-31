using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace CampusBalance.Core;

public static class ElectricityParser
{
    public static string CutoffNote(string text)
    {
        var match = Regex.Match(text, @"(?:截止|截至)\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})");
        if (!match.Success) return "学校电表";
        var normalized = $"{match.Groups[1].Value}-{match.Groups[2].Value.PadLeft(2, '0')}-{match.Groups[3].Value.PadLeft(2, '0')}";
        return CampusDates.ValidDay(normalized) ? "截至 " + normalized : "学校电表";
    }
    public static MeterReading Meter(string html, string id, Metric kind)
    {
        if (!Regex.IsMatch(id, @"\A[0-9]{1,30}\z") || kind is not (Metric.Lighting or Metric.Air)) throw CampusException.Invalid();
        var doc = SchoolHtml.Document(html).DocumentNode;
        var paragraphs = SchoolHtml.Nodes(doc, "//p").Select(SchoolHtml.Text).ToArray();
        string Field(params string[] names)
        {
            foreach (var name in names)
                if (paragraphs.FirstOrDefault(p => p.StartsWith(name, StringComparison.Ordinal)) is { } value) return value[name.Length..].Trim();
            throw new CampusException("FIELD_MISSING", "学校页面缺少字段：" + names[0].TrimEnd(':'), names[0].TrimEnd(':'));
        }
        decimal Number(string value, string field)
        {
            var text = Regex.Match(value, @"[-+]?\d+(?:\.\d+)?").Value;
            if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var result) || result < 0)
                throw new CampusException("METER_VALUE_INVALID", "学校返回的电价或剩余电量无效", field);
            return result;
        }
        if (Field("购电表号:") != id) throw new CampusException("METER_ID_MISMATCH", "学校返回的电表号与设置不符");
        if (!Field("地址:", "地哈哈址:").Contains(kind == Metric.Air ? "空调" : "照明")) throw new CampusException("METER_KIND_MISMATCH", "学校返回的电表类型与设置不符");
        var quantity = SchoolHtml.Nodes(doc, "//svg[@id='canvas1']//tspan").LastOrDefault() ?? throw new CampusException("FIELD_MISSING", "学校页面缺少字段：剩余电量", "剩余电量");
        var balance = Number(Field("电价:", "电哈哈价:"), "电价") * Number(SchoolHtml.Text(quantity), "剩余电量");
        return new MeterReading(decimal.Round(balance, 2, MidpointRounding.AwayFromZero), CutoffNote(paragraphs.FirstOrDefault(p => p.Contains("截止") || p.Contains("截至")) ?? ""), []);
    }
    public static IReadOnlyList<string[]> Csv(string text)
    {
        var rows = new List<string[]>(); var row = new List<string>(); var cell = new StringBuilder();
        var quoted = false; var afterQuote = false;
        text = text.TrimStart('\uFEFF');
        void EndCell() { row.Add(cell.ToString()); cell.Clear(); afterQuote = false; }
        void EndRow() { EndCell(); if (row.Any(v => v.Length > 0)) rows.Add(row.ToArray()); row.Clear(); }
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c != '"') cell.Append(c);
                else if (i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                else { quoted = false; afterQuote = true; }
            }
            else if (c == ',') EndCell();
            else if (c is '\r' or '\n') { if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++; EndRow(); }
            else if (c == '"' && cell.Length == 0 && !afterQuote) quoted = true;
            else if (afterQuote || c == '"') throw CampusException.Invalid();
            else cell.Append(c);
        }
        if (quoted) throw CampusException.Invalid();
        EndRow(); return rows;
    }
    public static Dictionary<Metric, MeterReading> History(string csv, DormSettings settings)
    {
        var rows = Csv(csv); var result = new Dictionary<Metric, MeterReading>();
        if (rows.Count == 0) return result;
        int Index(string name) { var index = Array.IndexOf(rows[0], name); return index < 0 ? throw CampusException.Invalid() : index; }
        var date = Index("date"); var key = Index("key"); var meter = Index("meter_id"); var value = Index("remaining_cny");
        foreach (var kind in new[] { Metric.Lighting, Metric.Air })
        {
            var id = kind == Metric.Lighting ? settings.Lighting : settings.Air;
            if (id.Length == 0) continue;
            var entries = new SortedDictionary<string, decimal>(StringComparer.Ordinal);
            foreach (var row in rows.Skip(1))
            {
                if (row.Length <= new[] { date, key, meter, value }.Max() || !CampusDates.ValidDay(row[date]) || row[meter] != id ||
                    row[key] != (kind == Metric.Lighting ? "lighting" : "air_conditioner") ||
                    !decimal.TryParse(row[value], NumberStyles.AllowDecimalPoint | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var amount) || amount < 0) continue;
                entries[row[date]] = amount;
            }
            if (entries.Count == 0) continue;
            var latest = entries.Last();
            result[kind] = new MeterReading(latest.Value, "截至 " + latest.Key,
                CampusDates.Differences(entries, DateOnly.ParseExact(latest.Key, "yyyy-MM-dd", CultureInfo.InvariantCulture)));
        }
        return result;
    }
}

public sealed class ElectricityClient(Diagnostics diagnostics, Func<HttpMessageHandler>? handlerFactory = null)
{
    public async Task<MeterReading> MeterAsync(string id, Metric kind, CancellationToken token)
    {
        if (!Regex.IsMatch(id, @"\A[0-9]{1,30}\z")) throw CampusException.Invalid();
        var stage = kind == Metric.Air ? "airMeter" : "lightingMeter";
        async Task<MeterReading> ReadAsync(string scheme)
        {
            using var http = new SchoolHttp(u => u.Scheme == scheme && u.Host == "shsd.buaa.edu.cn" && SchoolPolicy.PlainAuthority(u), handlerFactory?.Invoke(), false);
            var response = await http.SendAsync(SchoolPolicy.Url(scheme + "://shsd.buaa.edu.cn/PubBuaa", ("id", id)), token, timeout: TimeSpan.FromSeconds(7), limit: 2_000_000).ConfigureAwait(false);
            return ElectricityParser.Meter(response.Text, id, kind);
        }
        try { return await ReadAsync("https").ConfigureAwait(false); }
        catch (Exception ex) when (!token.IsCancellationRequested && CampusException.From(ex).Code is "CONNECTION_FAILED" or "TIMEOUT")
        {
            diagnostics.Report(ex, stage);
            try { return await ReadAsync("http").ConfigureAwait(false); }
            catch (Exception fallback) when (!token.IsCancellationRequested) { diagnostics.Report(fallback, stage, "http"); throw; }
        }
    }
    public async Task<Dictionary<Metric, MeterReading>> HistoryAsync(DormSettings settings, CancellationToken token)
    {
        settings = settings.Validate();
        if (settings.HistoryOwner.Length == 0) return [];
        using var http = new SchoolHttp(u => u.Scheme == "https" && u.Host == "raw.githubusercontent.com" && SchoolPolicy.PlainAuthority(u), handlerFactory?.Invoke(), false);
        var url = new Uri($"https://raw.githubusercontent.com/{settings.HistoryOwner}/buaa-electricity-monitor/main/data/history.csv");
        var response = await http.SendAsync(url, token, timeout: TimeSpan.FromSeconds(12), limit: 2_000_000).ConfigureAwait(false);
        return ElectricityParser.History(response.Text, settings);
    }
}
