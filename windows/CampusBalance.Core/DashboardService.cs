namespace CampusBalance.Core;

public sealed class DashboardService(SchoolClient client, SchoolSession session, LocalStore store, Diagnostics diagnostics,
    ICredentialStore credentials, bool autoLogin, Func<SchoolClient>? clientFactory = null) : IDisposable
{
    private SchoolClient client = client;
    private SchoolSession session = session;
    public string User => session.User;
    public DormSettings Settings => store.ReadSettings(User);
    public void SaveSettings(DormSettings settings) => store.SaveSettings(User, settings);

    private async Task<(decimal Value, string Number)> CardBalanceAsync(CancellationToken token)
    {
        try { return await client.CardBalanceAsync(session, token).ConfigureAwait(false); }
        catch (CampusException ex) when (ex.Code == "LOGIN_REQUIRED" && autoLogin)
        {
            SavedLogin? saved;
            try { saved = credentials.Read(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException or System.Text.Json.JsonException)
            { throw new CampusException("LOGIN_REQUIRED", "无法读取自动登录密码，请重新登录"); }
            if (saved is null || saved.User != session.User) throw CampusException.Login();
            var replacement = clientFactory?.Invoke() ?? new SchoolClient();
            try
            {
                var renewed = await replacement.LoginAsync(saved.User, saved.Password, saved.NetworkSamePassword, token).ConfigureAwait(false);
                var previous = client; client = replacement; session = renewed; previous.Dispose();
            }
            catch { replacement.Dispose(); throw; }
            return await client.CardBalanceAsync(session, token).ConfigureAwait(false);
        }
    }
    public async Task RefreshAsync(IProgress<BalanceReading> progress, CancellationToken token)
    {
        var electricity = ElectricityAsync(progress, token);
        // Card authentication runs first so network requests use the renewed cookie container.
        async Task SchoolAsync()
        {
            var authenticated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var card = CardAsync(progress, token, authenticated);
            await authenticated.Task.ConfigureAwait(false);
            await Task.WhenAll(card, NetworkAsync(progress, token)).ConfigureAwait(false);
        }
        // Observe all operations, including cancellation, before callers dispose the session.
        await Task.WhenAll(SchoolAsync(), electricity).ConfigureAwait(false);
    }
    private async Task CardAsync(IProgress<BalanceReading> progress, CancellationToken token, TaskCompletionSource authenticated)
    {
        try
        {
            token.ThrowIfCancellationRequested();
            var balance = await CardBalanceAsync(token).ConfigureAwait(false);
            var reading = new BalanceReading(Metric.Card, ReadingStatus.Ok, balance.Value, "当前余额", "校园卡消费 · 元", UpdatedAt: DateTimeOffset.UtcNow);
            progress.Report(reading);
            // Network can load once credentials are settled; it needn't wait for card history pages.
            authenticated.TrySetResult();
            try
            {
                var history = await client.CardHistoryAsync(balance.Number, token).ConfigureAwait(false);
                progress.Report(reading with { History = history.Days, Records = history.Records });
            }
            catch (Exception ex) when (!token.IsCancellationRequested)
            {
                diagnostics.Report(ex, "cardHistory");
                try
                {
                    var history = store.CaptureCard(User, balance.Value);
                    progress.Report(reading with { History = history.Days, Records = history.Records, HistoryNote = "余额减少估算 · 元" });
                }
                catch (Exception storageError) when (storageError is IOException or UnauthorizedAccessException)
                { progress.Report(reading with { HistoryNote = CampusException.From(ex).Message }); }
            }
        }
        catch (Exception ex) when (!token.IsCancellationRequested) { diagnostics.Report(ex, "cardBalance"); progress.Report(BalanceReading.Failure(Metric.Card, ex)); }
        finally { authenticated.TrySetResult(); }
    }
    private async Task NetworkAsync(IProgress<BalanceReading> progress, CancellationToken token)
    {
        try
        {
            token.ThrowIfCancellationRequested();
            var quota = await client.NetworkBalanceAsync(session, token).ConfigureAwait(false);
            var reading = new BalanceReading(Metric.Network, ReadingStatus.Ok, quota.Free + quota.Paid,
                $"本期已用 {quota.Used:0.00} GB", "按学校结算日 · GB", UpdatedAt: DateTimeOffset.UtcNow);
            progress.Report(reading);
            try
            {
                var history = await client.NetworkHistoryAsync(token).ConfigureAwait(false);
                progress.Report(reading with { History = history.Days, Records = history.Records });
            }
            catch (Exception ex) when (!token.IsCancellationRequested)
            { diagnostics.Report(ex, "networkHistory"); progress.Report(reading with { HistoryNote = CampusException.From(ex).Message }); }
        }
        catch (Exception ex) when (!token.IsCancellationRequested) { diagnostics.Report(ex, "networkBalance"); progress.Report(BalanceReading.Failure(Metric.Network, ex)); }
    }
    private async Task ElectricityAsync(IProgress<BalanceReading> progress, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var settings = Settings;
        var electricity = new ElectricityClient(diagnostics);
        async Task<Dictionary<Metric, MeterReading>> HistoryAsync()
        {
            try { return await electricity.HistoryAsync(settings, token).ConfigureAwait(false); }
            catch (Exception ex) when (!token.IsCancellationRequested) { diagnostics.Report(ex, "electricityHistory"); return []; }
        }
        var historyTask = HistoryAsync();
        async Task MeterAsync(Metric kind, string id)
        {
            if (id.Length == 0) { progress.Report(new BalanceReading(kind, ReadingStatus.Unavailable, Note: "请先设置宿舍电表")); return; }
            MeterReading? live = null;
            Exception? failure = null;
            try
            {
                live = await electricity.MeterAsync(id, kind, token).ConfigureAwait(false);
                progress.Report(new BalanceReading(kind, ReadingStatus.Ok, live.Value, live.Note, "暂无历史数据", UpdatedAt: DateTimeOffset.UtcNow));
            }
            catch (Exception ex) when (!token.IsCancellationRequested) { failure = ex; diagnostics.Report(ex, kind == Metric.Air ? "airMeter" : "lightingMeter"); }
            var history = (await historyTask.ConfigureAwait(false)).GetValueOrDefault(kind);
            if ((live ?? history) is { } value)
                progress.Report(new BalanceReading(kind, ReadingStatus.Ok, value.Value, value.Note,
                    history is null ? "暂无历史数据" : "余额减少估算 · 元", history?.History, UpdatedAt: live is null ? null : DateTimeOffset.UtcNow));
            else progress.Report(BalanceReading.Failure(kind, failure ?? CampusException.Invalid()));
        }
        await Task.WhenAll(MeterAsync(Metric.Lighting, settings.Lighting), MeterAsync(Metric.Air, settings.Air), historyTask).ConfigureAwait(false);
    }
    public void Dispose() => client.Dispose();
}
