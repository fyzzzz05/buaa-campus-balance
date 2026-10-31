using System.Net;
using CampusBalance.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace CampusBalance.App;

// WebView2 is confined to the school's authentication page. The dashboard is native XAML.
internal sealed class SchoolLoginWindow : Window
{
    private readonly WebView2 browser = new();
    private readonly InfoBar error = new() { Severity = InfoBarSeverity.Error, IsOpen = false };
    private readonly TaskCompletionSource<(SchoolClient Client, SchoolSession Session)?> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource cancellation = new();
    private readonly Core.Diagnostics diagnostics;
    private readonly string profileDirectory;
    private bool importing;
    private bool checkAgain;
    private bool closed;
    public SchoolLoginWindow(string root, Core.Diagnostics diagnostics)
    {
        this.diagnostics = diagnostics;
        profileDirectory = System.IO.Path.Combine(root, "Authentication");
        Title = "学校统一认证";
        AppWindow.Resize(new Windows.Graphics.SizeInt32(800, 720));
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition());
        grid.Children.Add(error); Grid.SetRow(browser, 1); grid.Children.Add(browser); Content = grid;
        grid.Loaded += Initialize;
        Closed += (_, _) =>
        {
            closed = true; cancellation.Cancel(); browser.Close(); completion.TrySetResult(null);
        };
    }
    public Task<(SchoolClient Client, SchoolSession Session)?> LoginAsync() { Activate(); return completion.Task; }
    private async void Initialize(object sender, RoutedEventArgs args)
    {
        ((Grid)sender).Loaded -= Initialize;
        try
        {
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync("", profileDirectory, new CoreWebView2EnvironmentOptions());
            if (closed) return;
            var options = environment.CreateCoreWebView2ControllerOptions(); options.IsInPrivateModeEnabled = true;
            await browser.EnsureCoreWebView2Async(environment, options);
            if (closed) return;
            var core = browser.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsWebMessageEnabled = false;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || !SchoolPolicy.Allowed(uri) || uri.Host == "zfw.buaa.edu.cn")
                { e.Cancel = true; error.Message = "学校登录发生了不受支持的跳转。"; error.IsOpen = true; }
            };
            core.NavigationCompleted += NavigationCompleted;
            core.Navigate(SchoolClient.LoginUrl);
        }
        catch (Exception ex) when (!closed)
        {
            diagnostics.Report(ex, "schoolLogin");
            error.Message = "无法打开学校登录页。请确认已安装 Microsoft Edge WebView2 Runtime，或返回使用账号密码登录。"; error.IsOpen = true;
        }
        catch (Exception) when (closed) { }
    }
    private async void NavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (closed || !args.IsSuccess || !Uri.TryCreate(sender.Source, UriKind.Absolute, out var uri) ||
            uri.Host is not ("www.cc-pay.cn" or "pass.cc-pay.cn" or "mall.cc-pay.cn")) return;
        if (importing) { checkAgain = true; return; }
        await VerifySessionAsync(sender);
    }
    private async Task VerifySessionAsync(CoreWebView2 sender)
    {
        importing = true;
        SchoolClient? client = null;
        try
        {
            var cookies = await sender.CookieManager.GetCookiesAsync("");
            if (closed) return;
            client = new SchoolClient();
            var session = await client.LoginWithCookiesAsync(cookies.Select(c => new Cookie(c.Name, c.Value, c.Path, c.Domain)
                { Secure = c.IsSecure, HttpOnly = c.IsHttpOnly }), cancellation.Token);
            if (closed) { client.Dispose(); return; }
            if (completion.TrySetResult((client, session))) { client = null; Close(); }
        }
        catch (Exception ex) when (!closed)
        {
            // The initial cc-pay login page can finish before the user has authenticated.
            diagnostics.Report(ex, "schoolLogin");
        }
        catch (Exception) when (closed) { }
        finally
        {
            client?.Dispose(); importing = false;
            if (checkAgain && !closed) { checkAgain = false; await VerifySessionAsync(sender); }
        }
    }
}
