using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CampusBalance.Core;

public sealed record SavedLogin(string User, string Password, bool NetworkSamePassword);
public interface ICredentialStore
{
    SavedLogin? Read();
    void Save(SavedLogin login);
    void Clear();
}

public sealed class LocalStore(string? root = null)
{
    public string Root { get; } = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CampusBalance");
    private string AccountFile(string user, string kind) => Path.Combine(Root, "users", Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(user))) + "." + kind + ".json");
    public static void AtomicWrite(string file, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temporary, text, new UTF8Encoding(false)); File.Move(temporary, file, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public DormSettings ReadSettings(string user)
    {
        try
        {
            var file = AccountFile(user, "settings");
            return File.Exists(file) ? (JsonSerializer.Deserialize<DormSettings>(File.ReadAllText(file)) ?? new()).Validate() : new();
        }
        catch (Exception ex) when (ex is JsonException or IOException or CampusException) { return new(); }
    }
    public void SaveSettings(string user, DormSettings settings) => AtomicWrite(AccountFile(user, "settings"), JsonSerializer.Serialize(settings.Validate()));
    public HistoryResult CaptureCard(string user, decimal value, DateOnly? today = null)
    {
        if (value < 0) throw CampusException.Invalid();
        var file = AccountFile(user, "card-balances");
        Dictionary<string, decimal> balances;
        try { balances = File.Exists(file) ? JsonSerializer.Deserialize<Dictionary<string, decimal>>(File.ReadAllText(file)) ?? [] : []; }
        catch (Exception ex) when (ex is JsonException or IOException) { balances = []; }
        var date = today ?? CampusDates.Today();
        balances[date.ToString("yyyy-MM-dd")] = value;
        balances = balances.Where(p => CampusDates.ValidDay(p.Key) && p.Value >= 0).OrderBy(p => p.Key, StringComparer.Ordinal).TakeLast(90).ToDictionary();
        AtomicWrite(file, JsonSerializer.Serialize(balances));
        var history = CampusDates.Differences(balances, date);
        return new HistoryResult(history, history.Reverse().Where(p => p.Value is not null).Select(p =>
            new CampusRecord("余额减少估算", p.Date, "¥" + p.Value!.Value.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture))).ToArray());
    }
}
