using System.Globalization;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace CampusBalance.Core;

public sealed record LoginForm(Uri Action, Dictionary<string, string> Fields);
public sealed record NetworkRow(string Date, decimal Bytes);
public sealed record NetworkPage(int Total, IReadOnlyList<NetworkRow> Rows);

public static class SchoolHtml
{
    internal static HtmlDocument Document(string html)
    {
        if (System.Text.Encoding.UTF8.GetByteCount(html) > 3_000_000) throw CampusException.Invalid();
        var document = new HtmlDocument(); document.LoadHtml(html); return document;
    }
    internal static IEnumerable<HtmlNode> Nodes(HtmlNode node, string xpath) => node.SelectNodes(xpath)?.AsEnumerable() ?? [];
    internal static string Text(HtmlNode node) => Regex.Replace(HtmlEntity.DeEntitize(node.InnerText), @"\s+", " ").Trim();
    public static LoginForm ParseLogin(string html, Uri source)
    {
        if (!SchoolPolicy.Allowed(source) || source.Host != "sso.buaa.edu.cn") throw CampusException.Login();
        var form = Document(html).DocumentNode.SelectSingleNode("//form[@id='loginForm']") ?? throw CampusException.Invalid();
        var fields = new Dictionary<string, string>();
        foreach (var input in Nodes(form, ".//input[@name]"))
        {
            var name = input.GetAttributeValue("name", "");
            if (name is "execution" or "_eventId" or "type") fields[name] = HtmlEntity.DeEntitize(input.GetAttributeValue("value", ""));
        }
        if (!fields.ContainsKey("execution") || !Uri.TryCreate(source, HtmlEntity.DeEntitize(form.GetAttributeValue("action", "")), out var action) ||
            !SchoolPolicy.Allowed(action) || action.Host != "sso.buaa.edu.cn") throw CampusException.Invalid();
        return new LoginForm(action, fields);
    }
    public static decimal QuotaValue(string value)
    {
        var match = Regex.Match(value.Trim(), @"\A(\d+(?:\.\d+)?)\s*(G|GB|M|MB|K|KB|T|TB|B|BYTE|BYTES)\z", RegexOptions.IgnoreCase);
        if (!match.Success || !decimal.TryParse(match.Groups[1].Value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number))
            throw new CampusException("QUOTA_VALUE_INVALID", "校园网流量数值或单位无法识别");
        return char.ToUpperInvariant(match.Groups[2].Value[0]) switch
        {
            'G' => number, 'M' => number / 1024, 'K' => number / 1048576,
            'T' => number * 1024, _ => number / 1073741824
        };
    }
    public static NetworkQuota Quota(string html)
    {
        var doc = Document(html).DocumentNode;
        if (doc.SelectSingleNode("//form[@id='login-form']") is not null) throw CampusException.Login();
        foreach (var table in Nodes(doc, "//table"))
        {
            var rows = Nodes(table, ".//tr").ToArray();
            for (var i = 0; i < rows.Length; i++)
            {
                var labels = Nodes(rows[i], "./th|./td").Select(Text).ToArray();
                var free = Array.FindIndex(labels, s => s.Contains("免费流量剩余"));
                var paid = Array.FindIndex(labels, s => s.Contains("计费流量剩余"));
                var used = Array.FindIndex(labels, s => s.Contains("已用流量"));
                if (Math.Min(free, Math.Min(paid, used)) < 0) continue;
                if (i + 1 >= rows.Length) throw CampusException.Invalid();
                var values = Nodes(rows[i + 1], "./th|./td").Select(Text).ToArray();
                if (values.Length <= Math.Max(free, Math.Max(paid, used))) throw CampusException.Invalid();
                return new NetworkQuota(QuotaValue(values[free]), QuotaValue(values[paid]), QuotaValue(values[used]));
            }
        }
        throw new CampusException("QUOTA_TABLE_MISSING", "校园网流量表缺失，学校页面可能已变化");
    }
    public static NetworkPage NetworkHistory(string html)
    {
        var doc = Document(html).DocumentNode;
        if (doc.SelectSingleNode("//form[@id='login-form']") is not null) throw CampusException.Login();
        var summary = doc.SelectSingleNode("//*[contains(concat(' ',normalize-space(@class),' '),' summary ')]");
        var match = Regex.Match(summary is null ? "" : Text(summary), @"共\s*([0-9,]+)\s*条");
        if (!match.Success || !int.TryParse(match.Groups[1].Value.Replace(",", ""), out var total) ||
            !Nodes(doc, "//table").Any(t => Text(t).Contains("总流量"))) throw CampusException.Invalid();
        var rows = new List<NetworkRow>();
        foreach (var row in Nodes(doc, "//table//tbody/tr"))
        {
            var cells = Nodes(row, "./td").Select(Text).ToArray();
            if (cells.Length < 6 || !Regex.IsMatch(cells[1], @"\A\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")) continue;
            if (!decimal.TryParse(cells[4].Replace(",", ""), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var bytes) || bytes < 0)
                throw CampusException.Invalid();
            rows.Add(new NetworkRow(cells[1], bytes));
        }
        return new NetworkPage(total, rows);
    }
}
