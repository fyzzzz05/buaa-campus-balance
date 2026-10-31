using System.Collections.ObjectModel;
using System.Diagnostics;
using CampusBalance.Core;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.Graphics;
using Windows.System;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace CampusBalance.App;

public sealed partial class MainWindow : Window
{
    private readonly LocalStore store = new();
    private readonly CredentialStore credentials;
    private readonly Core.Diagnostics diagnostics;
    private readonly ObservableCollection<BalanceReading> readings = new(Enum.GetValues<Metric>().Select(m => new BalanceReading(m, ReadingStatus.Loading)));
    private readonly CancellationTokenSource lifetime = new();
    private readonly List<RailEntry> railEntries = new();
    private readonly List<Button> ghostButtons = new();
    private DashboardService? dashboard;
    private CancellationTokenSource? refreshCancellation;
    private Task refreshTask = Task.CompletedTask;
    private bool loginBusy;
    private bool closing;
    private int generation;
    private SchoolLoginWindow? schoolLogin;
    private readonly RotateTransform extraSettingsChevronTransform;
    private DateTimeOffset lastRefresh;
    private int selectedMetric;
    private bool lineMode;
    private bool settingsOpen;
    private bool animationsEnabled = true;

    public MainWindow()
    {
        InitializeComponent();
        credentials = new CredentialStore(store.Root);
        diagnostics = new Core.Diagnostics(System.IO.Path.Combine(store.Root, "Logs"));
        animationsEnabled = ReadAnimationsEnabled();
        extraSettingsChevronTransform = (RotateTransform)ExtraSettingsChevron.RenderTransform;
        Root.Loaded += Root_Loaded;
        Root.ActualThemeChanged += (_, _) => OnThemeChanged();
        Root.SizeChanged += (_, _) => ApplyResponsiveLayout();
        ChartHost.SizeChanged += (_, _) => RenderChart(animate: false);
        ChartModeSwitch.SizeChanged += (_, _) => UpdateChartModeSwitch(animate: false);
        ChartHost.PointerMoved += ChartHost_PointerMoved;
        ChartHost.PointerExited += (_, _) => ClearChartHover();
        AppWindow.Resize(new SizeInt32(1050, 720));
        AppWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico"));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = 420;
            presenter.PreferredMinimumHeight = 560;
        }
        ConfigureTitleBar();
        BuildRail();
        AttachHover(MeterButton, ghost: true);
        AttachHover(MoreButton, ghost: true);
        AttachHover(LogoutButton, ghost: true);
        AttachHover(SchoolLoginButton, ghost: true);
        AttachHover(LoginButton, ghost: false);
        AttachHover(SettingsCancel, ghost: true);
        AttachHover(SettingsSave, ghost: false);
        UpdateChartModeSwitch(animate: false);
        Activated += async (_, args) =>
        {
            if (args.WindowActivationState != WindowActivationState.Deactivated && dashboard is not null &&
                DateTimeOffset.UtcNow - lastRefresh > TimeSpan.FromMinutes(15)) await RefreshAsync();
        };
        Closed += (_, _) =>
        {
            closing = true; generation++; lifetime.Cancel(); refreshCancellation?.Cancel(); schoolLogin?.Close();
            // Disposing the transport cancels any final in-flight requests when the process exits.
            dashboard?.Dispose(); lifetime.Dispose();
        };
    }

    // ===================== 启动 / 主题 =====================

    private static bool ReadAnimationsEnabled()
    {
        try { return new UISettings().AnimationsEnabled; }
        catch { return true; }
    }

    private bool ReduceMotion => !animationsEnabled;

    private void ConfigureTitleBar()
    {
        var dark = Root.ActualTheme == ElementTheme.Dark;
        var background = dark ? Color.FromArgb(255, 0x0F, 0x14, 0x1C) : Color.FromArgb(255, 0xEC, 0xEF, 0xF4);
        var ink = dark ? Color.FromArgb(255, 0xEA, 0xEF, 0xF7) : Color.FromArgb(255, 0x18, 0x21, 0x2F);
        var hover = dark ? Color.FromArgb(255, 0x1D, 0x26, 0x33) : Color.FromArgb(255, 0xE2, 0xE7, 0xEF);
        if (!AppWindowTitleBar.IsCustomizationSupported()) return;
        var bar = AppWindow.TitleBar;
        bar.BackgroundColor = background;
        bar.ForegroundColor = ink;
        bar.InactiveBackgroundColor = background;
        bar.InactiveForegroundColor = ink;
        bar.ButtonBackgroundColor = background;
        bar.ButtonForegroundColor = ink;
        bar.ButtonInactiveBackgroundColor = background;
        bar.ButtonInactiveForegroundColor = ink;
        bar.ButtonHoverBackgroundColor = hover;
        bar.ButtonHoverForegroundColor = ink;
        bar.ButtonPressedBackgroundColor = hover;
        bar.ButtonPressedForegroundColor = ink;
    }

    private void OnThemeChanged()
    {
        ConfigureTitleBar();
        RenderRail();
        RenderPanel(animate: false);
    }

    // ===================== 主题画刷（代码绘制时读取，保持与 XAML 主题一致） =====================

    private Brush InkBrush => ProbeInk.Foreground;
    private Brush MutedBrush => ProbeMuted.Foreground;
    private Brush PanelBrush => ProbePanel.Background;
    private Brush LineBrush => ProbeLine.Background;
    private Brush AccentBrush => ProbeAccent.Foreground;
    private Brush OnAccentBrush => ProbeOnAccent.Foreground;
    private Brush HoverBrush => ProbeHover.Background;
    private Color AccentColor => ((SolidColorBrush)AccentBrush).Color;
    private Color PanelColor => ((SolidColorBrush)PanelBrush).Color;
    private Color InkColor => ((SolidColorBrush)InkBrush).Color;

    private static ExponentialEase EaseOut => new() { EasingMode = EasingMode.EaseOut, Exponent = 4 };

    private void Animate(DependencyObject target, string property, double from, double to, TimeSpan duration, TimeSpan? begin = null)
    {
        var animation = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration = new Duration(duration),
            BeginTime = begin,
            EasingFunction = EaseOut,
        };
        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, property);
        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        storyboard.Begin();
    }

    private void AnimateColor(SolidColorBrush brush, Color to, TimeSpan duration)
    {
        var animation = new ColorAnimation { To = to, Duration = new Duration(duration), EasingFunction = EaseOut };
        Storyboard.SetTarget(animation, brush);
        Storyboard.SetTargetProperty(animation, "Color");
        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        storyboard.Begin();
    }

    private void AttachHover(Button button, bool ghost)
    {
        if (ghost) ghostButtons.Add(button);
        button.PointerEntered += (_, _) =>
        {
            if (!button.IsEnabled) return;
            if (ghost) { button.BorderBrush = AccentBrush; button.Foreground = AccentBrush; }
            else button.Opacity = 0.86;
        };
        button.PointerExited += (_, _) =>
        {
            if (ghost) { button.BorderBrush = LineBrush; button.Foreground = InkBrush; }
            else button.Opacity = button.IsEnabled ? 1 : 0.6;
        };
        button.PointerPressed += (_, _) => { if (button.IsEnabled && !ghost) button.Opacity = 0.72; };
        button.PointerReleased += (_, _) => { if (!ghost) button.Opacity = 1; };
        button.PointerCanceled += (_, _) => { if (!ghost) button.Opacity = 1; };
    }

    // ===================== 登录页 =====================

    private async void Root_Loaded(object sender, RoutedEventArgs e)
    {
        Root.Loaded -= Root_Loaded;
        ApplyResponsiveLayout();
        SavedLogin? saved;
        try { saved = credentials.Read(); }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or System.Text.Json.JsonException or System.IO.IOException or UnauthorizedAccessException)
        { ShowLoginError("无法读取保存的密码，请重新登录。"); return; }
        if (saved is null) { UserInput.Focus(FocusState.Programmatic); return; }
        UserInput.Text = saved.User;
        NetworkSame.IsChecked = saved.NetworkSamePassword;
        Remember.IsChecked = true;
        await LoginAsync(saved.User, saved.Password, saved.NetworkSamePassword, true);
    }

    private void ShowLoginError(string message)
    {
        LoginError.Text = message;
        LoginError.Visibility = Visibility.Visible;
    }

    private void ClearLoginError()
    {
        LoginError.Text = "";
        LoginError.Visibility = Visibility.Collapsed;
    }

    private void SetLoginBusy(bool value)
    {
        loginBusy = value;
        UserInput.IsEnabled = PasswordInput.IsEnabled = NetworkSame.IsEnabled = Remember.IsEnabled = LoginButton.IsEnabled = SchoolLoginButton.IsEnabled = !value;
        LoginButtonText.Text = value ? "登录中…" : "登录";
        LoginArrow.Visibility = value ? Visibility.Collapsed : Visibility.Visible;
        LoginButton.Opacity = value ? 0.6 : 1;
        SchoolLoginButton.Opacity = value ? 0.5 : 1;
    }

    private async void Login_Click(object sender, RoutedEventArgs e) =>
        await LoginAsync(UserInput.Text.Trim(), PasswordInput.Password, NetworkSame.IsChecked == true, Remember.IsChecked == true);

    private async void Password_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        await LoginAsync(UserInput.Text.Trim(), PasswordInput.Password, NetworkSame.IsChecked == true, Remember.IsChecked == true);
    }

    private void RevealPassword_Click(object sender, RoutedEventArgs e)
    {
        var reveal = PasswordInput.PasswordRevealMode != PasswordRevealMode.Visible;
        PasswordInput.PasswordRevealMode = reveal ? PasswordRevealMode.Visible : PasswordRevealMode.Hidden;
        RevealEyeOpen.Visibility = reveal ? Visibility.Collapsed : Visibility.Visible;
        RevealEyeClosed.Visibility = reveal ? Visibility.Visible : Visibility.Collapsed;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(RevealPassword, reveal ? "隐藏密码" : "显示密码");
    }

    private async Task LoginAsync(string user, string password, bool network, bool remember)
    {
        if (loginBusy || closing) return;
        if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(password)) { ShowLoginError("请输入学号或工号，以及密码。"); return; }
        SetLoginBusy(true);
        ClearLoginError();
        var client = new SchoolClient();
        try
        {
            var session = await client.LoginAsync(user, password, network, lifetime.Token);
            if (closing) { client.Dispose(); return; }
            if (remember) credentials.Save(new SavedLogin(user, password, network)); else credentials.Clear();
            EnterDashboard(client, session, remember);
        }
        catch (Exception ex) when (!closing)
        {
            client.Dispose(); diagnostics.Report(ex, "schoolLogin");
            ShowLoginError(ex is System.Security.Cryptography.CryptographicException or System.IO.IOException or UnauthorizedAccessException
                ? "无法安全保存密码，请取消自动重新登录后重试。" : CampusException.From(ex).Message);
        }
        catch (OperationCanceledException) { client.Dispose(); }
        catch (Exception) when (closing) { client.Dispose(); }
        finally
        {
            PasswordInput.Password = "";
            if (!closing) SetLoginBusy(false);
        }
        if (dashboard is not null && !closing) await RefreshAsync();
    }

    private async void SchoolLogin_Click(object sender, RoutedEventArgs e)
    {
        if (loginBusy || schoolLogin is not null) return;
        SetLoginBusy(true);
        ClearLoginError();
        schoolLogin = new SchoolLoginWindow(store.Root, diagnostics);
        try
        {
            var result = await schoolLogin.LoginAsync();
            if (result is null) return;
            if (closing) { result.Value.Client.Dispose(); return; }
            try { credentials.Clear(); EnterDashboard(result.Value.Client, result.Value.Session, false); }
            catch { result.Value.Client.Dispose(); throw; }
        }
        catch (Exception ex) when (!closing)
        {
            diagnostics.Report(ex, "schoolLogin");
            ShowLoginError("学校网页登录未完成。请重试，或使用账号密码登录。");
        }
        finally { schoolLogin = null; if (!closing) SetLoginBusy(false); }
        if (dashboard is not null && !closing) await RefreshAsync();
    }

    private void EnterDashboard(SchoolClient client, SchoolSession session, bool remember)
    {
        generation++;
        dashboard?.Dispose();
        dashboard = new DashboardService(client, session, store, diagnostics, credentials, remember);
        for (var i = 0; i < readings.Count; i++) readings[i] = new BalanceReading((Metric)i, ReadingStatus.Loading);
        LoginView.Visibility = Visibility.Collapsed;
        DashboardView.Visibility = Visibility.Visible;
        selectedMetric = 0;
        UpdateRailContent();
        UpdateMeterDot();
        ApplyResponsiveLayout();
        SelectMetric(0, focus: false);
        UpdateChartModeSwitch(animate: false);
    }

    // ===================== 仪表盘：刷新 =====================

    private async Task RefreshAsync()
    {
        if (dashboard is null || closing || !refreshTask.IsCompleted) return;
        refreshCancellation?.Dispose();
        refreshCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        var currentGeneration = generation;
        var currentDashboard = dashboard;
        Stamp.Text = "正在查询";
        lastRefresh = DateTimeOffset.UtcNow;
        // DispatcherQueue is explicit: WinUI does not guarantee a SynchronizationContext.
        var progress = new CallbackProgress(reading => DispatcherQueue.TryEnqueue(() =>
        {
            if (closing || currentGeneration != generation) return;
            readings[(int)reading.Metric] = reading;
            UpdateRailContent();
            if ((int)reading.Metric == selectedMetric) RenderPanel(animate: true);
        }));
        refreshTask = currentDashboard.RefreshAsync(progress, refreshCancellation.Token);
        try
        {
            await refreshTask;
            if (!closing && currentGeneration == generation)
                Stamp.Text = "更新于 " + DateTime.Now.Month + " 月 " + DateTime.Now.Day + " 日";
        }
        catch (OperationCanceledException) { }
        catch (Exception) when (closing) { }
        catch (Exception ex) when (!closing)
        {
            diagnostics.Report(ex, "refresh");
            Stamp.Text = "查询失败，请重试";
        }
    }

    private sealed class CallbackProgress(Action<BalanceReading> callback) : IProgress<BalanceReading>
    { public void Report(BalanceReading value) => callback(value); }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

    private async void Refresh_Invoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    { args.Handled = true; await RefreshAsync(); }

    private void Close_Invoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    { args.Handled = true; Close(); }

    // ===================== 仪表盘：退出 / 交互 =====================

    private async void Logout_Click(object sender, RoutedEventArgs e)
    {
        generation++; refreshCancellation?.Cancel();
        try { await refreshTask; } catch (OperationCanceledException) { } catch (Exception ex) { diagnostics.Report(ex, "logout"); }
        if (closing) return;
        try { credentials.Clear(); }
        catch (Exception ex) when (ex is System.IO.IOException or UnauthorizedAccessException)
        { Stamp.Text = "无法清除保存的密码，请重试"; return; }
        dashboard?.Dispose(); dashboard = null;
        LoginView.Visibility = Visibility.Visible;
        DashboardView.Visibility = Visibility.Collapsed;
        PasswordInput.Password = "";
        ClearLoginError();
        UserInput.Focus(FocusState.Programmatic);
    }

    private void Root_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (settingsOpen)
        {
            if (e.Key == VirtualKey.Escape) { e.Handled = true; CloseSettings(); }
            return;
        }
        if (DashboardView.Visibility != Visibility.Visible) return;
        if (e.OriginalSource is TextBox or PasswordBox) return;
        if (e.Key == VirtualKey.Down) { e.Handled = true; SelectMetric((selectedMetric + 1) % readings.Count, focus: true); }
        else if (e.Key == VirtualKey.Up) { e.Handled = true; SelectMetric((selectedMetric + readings.Count - 1) % readings.Count, focus: true); }
    }

    private void Theme_Click(object sender, RoutedEventArgs e)
    {
        var tag = (sender as MenuFlyoutItem)?.Tag as string;
        Root.RequestedTheme = tag switch
        {
            "Light" => ElementTheme.Light,
            "Dark" => ElementTheme.Dark,
            _ => ElementTheme.Default,
        };
    }

    // ===================== 电表号设置（自定义遮罩对话框） =====================

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        if (dashboard is null || settingsOpen) return;
        var settings = dashboard.Settings;
        LightingInput.Text = settings.Lighting;
        AirInput.Text = settings.Air;
        DormInput.Text = settings.Dorm;
        HistoryOwnerInput.Text = settings.HistoryOwner;
        SettingsError.Visibility = Visibility.Collapsed;
        SettingsError.Text = "";
        ExtraSettingsPanel.Visibility = Visibility.Collapsed;
        extraSettingsChevronTransform.Angle = 0;
        settingsOpen = true;
        MeterOverlay.Visibility = Visibility.Visible;
        if (!ReduceMotion)
        {
            MeterOverlay.Opacity = 0;
            Animate(MeterOverlay, "Opacity", 0, 1, TimeSpan.FromMilliseconds(240));
            MeterCard.RenderTransform = new TranslateTransform { Y = 12 };
            Animate((TranslateTransform)MeterCard.RenderTransform, "Y", 12, 0, TimeSpan.FromMilliseconds(350));
        }
        LightingInput.Focus(FocusState.Programmatic);
    }

    private void CloseSettings()
    {
        settingsOpen = false;
        MeterOverlay.Visibility = Visibility.Collapsed;
        MeterOverlay.Opacity = 1;
    }

    private void SettingsCancel_Click(object sender, RoutedEventArgs e) => CloseSettings();

    private void ExtraSettings_Click(object sender, RoutedEventArgs e)
    {
        var open = ExtraSettingsPanel.Visibility != Visibility.Visible;
        ExtraSettingsPanel.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
        extraSettingsChevronTransform.Angle = open ? 90 : 0;
    }

    private async void SettingsSave_Click(object sender, RoutedEventArgs e)
    {
        if (dashboard is null) { CloseSettings(); return; }
        SettingsError.Visibility = Visibility.Collapsed;
        try
        {
            var settings = new DormSettings(DormInput.Text, LightingInput.Text, AirInput.Text, HistoryOwnerInput.Text);
            dashboard.SaveSettings(settings);
        }
        catch (Exception ex) when (ex is CampusException or System.IO.IOException or UnauthorizedAccessException)
        {
            SettingsError.Text = ex is CampusException ? ex.Message : "保存失败，请检查填写的信息";
            SettingsError.Visibility = Visibility.Visible;
            return;
        }
        UpdateMeterDot();
        CloseSettings();
        generation++;
        refreshCancellation?.Cancel();
        try { await refreshTask; } catch (OperationCanceledException) { } catch (Exception ex) { diagnostics.Report(ex, "refresh"); }
        await RefreshAsync();
    }

    private void UpdateMeterDot()
    {
        if (dashboard is null) { MeterDot.Visibility = Visibility.Collapsed; return; }
        var settings = dashboard.Settings;
        var complete = settings.Lighting.Length > 0 && settings.Air.Length > 0;
        MeterDot.Visibility = complete ? Visibility.Collapsed : Visibility.Visible;
    }

    // ===================== 更多菜单 / 诊断 =====================

    private void Logs_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            System.IO.Directory.CreateDirectory(diagnostics.DirectoryPath);
            var start = new ProcessStartInfo("explorer.exe") { UseShellExecute = true };
            start.ArgumentList.Add(diagnostics.DirectoryPath);
            Process.Start(start);
        }
        catch (Exception ex) when (ex is System.IO.IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        { Stamp.Text = "无法打开诊断日志目录"; }
    }

    private void Updates_Click(object sender, RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo("https://github.com/fyzzzz05/buaa-campus-balance/releases/latest") { UseShellExecute = true });

    // ===================== 响应式布局（对应 dashboard.html 的媒体查询） =====================

    private void ApplyResponsiveLayout()
    {
        var width = Root.ActualWidth;
        var height = Root.ActualHeight;
        if (width < 1 || height < 1) return;
        var narrow = width < 760;
        var small = width < 460;
        var shortWindow = height < 760;

        // 左栏宽度：clamp(240px, 27%, 340px)；窄窗口改为 minmax(126px, 31%)。
        var boardWidth = Math.Max(240, width - (narrow ? 28 : 64));
        RailColumn.Width = new GridLength(small ? 120 : narrow ? Math.Max(126, boardWidth * 0.31) : Math.Clamp(boardWidth * 0.27, 240, 340));

        DashboardView.Padding = narrow ? new Thickness(14, 14, 14, 14) : new Thickness(32, 24, 32, 24);
        HeaderRow.Margin = new Thickness(4, 0, 4, shortWindow ? 10 : 16);
        MainPanel.Padding = small ? new Thickness(16, 16, 10, 12) : narrow ? new Thickness(20, 20, 14, 14) : new Thickness(28, 28, 32, 24);
        MainPanel.RowSpacing = shortWindow ? 10 : 18;
        RailPanel.Padding = shortWindow ? new Thickness(8, 8, 8, 8) : new Thickness(narrow ? 8 : 14, narrow ? 8 : 14, narrow ? 8 : 14, narrow ? 8 : 14);
        RailItems.Spacing = shortWindow ? 4 : narrow ? 5 : 8;
        RailHint.Visibility = narrow ? Visibility.Collapsed : Visibility.Visible;
        Stamp.Visibility = width < 560 ? Visibility.Collapsed : Visibility.Visible;

        MetricTitle.FontSize = small ? 17 : 20;
        HistoryNote.FontSize = narrow ? 12 : 13;
        PanelHeader.ColumnSpacing = narrow ? 8 : 12;

        var railValueSize = narrow ? Math.Clamp(width * 0.045, 18, 28) : shortWindow ? Math.Clamp(height * 0.043, 22, 30) : 34;
        var railVertical = shortWindow ? Math.Clamp(height * 0.015, 7, 12) : 20;
        var railHorizontal = narrow ? 10 : 18;
        var railPadding = new Thickness(railHorizontal, railVertical, railHorizontal, railVertical);
        foreach (var entry in railEntries)
        {
            entry.Host.Padding = railPadding;
            entry.Value.FontSize = railValueSize;
            entry.Unit.FontSize = narrow ? 11 : 14;
            entry.Unit.Margin = new Thickness(narrow ? 3 : 5, 0, 0, narrow ? 1 : 2);
            entry.Name.FontSize = narrow ? 12 : 13;
            entry.Note.FontSize = 12;
            entry.Note.Visibility = narrow ? Visibility.Collapsed : Visibility.Visible;
        }

        // 统计区：≥460 三列；更窄时改成两列并让“单日最高”换到第二行。
        var twoColumns = width < 460;
        StatsGrid.ColumnSpacing = narrow ? 5 : 12;
        StatsGrid.RowSpacing = twoColumns ? 10 : 0;
        Grid.SetRow(StatMaxBox, twoColumns ? 1 : 0);
        Grid.SetColumn(StatMaxBox, twoColumns ? 0 : 2);
        Grid.SetColumn(StatAverageBox, 1);
        var statSize = narrow ? 16 : shortWindow ? 19 : 22;
        Sum.FontSize = Average.FontSize = Maximum.FontSize = statSize;

        // 图表高度：clamp(130px,32vh,230px) / 230~280 / clamp(280px,38vh,460px)。
        var chartHeight = width >= 1100 && height >= 850 ? Math.Clamp(height * 0.38, 280, 460)
            : shortWindow ? Math.Clamp(height * 0.32, 130, 230)
            : narrow ? 230
            : 280;
        ChartHost.Height = chartHeight;

        LoginCard.Padding = width < 480 ? new Thickness(24, 30, 24, 30) : new Thickness(36, 36, 36, 36);
        LoginHost.MinHeight = Math.Max(600, height - 48);

        var segMin = narrow ? 48 : 64;
        BarModeButton.MinWidth = LineModeButton.MinWidth = segMin;
        BarModeButton.Padding = LineModeButton.Padding = narrow ? new Thickness(9, 6, 9, 6) : new Thickness(14, 6, 14, 6);

        UpdateChartModeSwitch(animate: false);
        RepositionPill(animate: false);
        RenderChart(animate: false);
    }
}
