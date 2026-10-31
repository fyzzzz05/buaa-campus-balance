using Microsoft.UI.Xaml;

namespace CampusBalance.App;

public partial class App : Application
{
    private Window? window;
    public App()
    {
        StartupFailure.CheckLayout();
        UnhandledException += (_, args) => StartupFailure.Record("unhandledUI", args.Exception, includeMessage: false);
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception error) StartupFailure.Record("unhandledCLR", error, includeMessage: false);
        };
        try { InitializeComponent(); }
        catch (Exception error) { StartupFailure.Record("appResources", error, includeMessage: true); throw; }
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            window = new MainWindow();
            window.Activate();
        }
        catch (Exception error) { StartupFailure.Record("mainWindow", error, includeMessage: true); throw; }
    }
}
