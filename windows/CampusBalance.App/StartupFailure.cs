using System.Runtime.InteropServices;
using System.Text.Json;

namespace CampusBalance.App;

internal static class StartupFailure
{
    private static readonly object Gate = new();
    private static int notified;
    // WinUI 3 未打包应用需要 exe 同目录下的 PRI 资源索引。dotnet publish 曾漏带该文件
    // （microsoft/WindowsAppSDK#6720），此时进程会在 XAML 初始化时以 0xC000027B 直接崩溃，
    // 事件日志里只有 Microsoft.UI.Xaml.dll。先检查目录，给出可以理解的提示再退出。
    public static void CheckLayout()
    {
        try
        {
            var directory = AppContext.BaseDirectory;
            var names = Directory.EnumerateFiles(directory, "*.pri").Select(path => Path.GetFileName(path)).ToArray();
            if (names.Any(name => string.Equals(name, "CampusBalance.pri", StringComparison.OrdinalIgnoreCase) ||
                                  string.Equals(name, "resources.pri", StringComparison.OrdinalIgnoreCase))) return;
            var xbfCount = Directory.EnumerateFiles(directory, "*.xbf").Count();
            Record("layout", new InvalidOperationException($"缺少 WinUI 资源索引：{directory} 下没有 CampusBalance.pri，xbf 数量 {xbfCount}"),
                includeMessage: true, notify: false);
            MessageBoxW(0, "校园余额安装目录不完整：缺少 WinUI 资源索引 CampusBalance.pri。\n"
                + "请重新执行 windows\\build.ps1，或确认复制的是整个 artifacts 目录。\n目录：" + directory,
                "校园余额", 0x10);
            Environment.Exit(2);
        }
        catch { /* 检查本身失败时继续启动，交给正常流程处理。 */ }
    }
    public static void Record(string stage, Exception error, bool includeMessage, bool notify = true)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CampusBalance", "Logs");
            Directory.CreateDirectory(directory);
            var file = Path.Combine(directory, "startup.ndjson");
            var exceptions = new List<object>();
            for (Exception? current = error; current is not null && exceptions.Count < 8; current = current.InnerException)
            {
                // Messages are allowed only for synchronous construction, before school login.
                // Later unhandled exceptions omit messages and request details entirely.
                exceptions.Add(new { type = current.GetType().FullName, hresult = $"0x{current.HResult:X8}",
                    message = includeMessage ? current.Message : null, stack = current.StackTrace });
            }
            lock (Gate)
            {
                if (File.Exists(file) && new FileInfo(file).Length >= 262144) File.Move(file, file + ".1", true);
                File.AppendAllText(file, JsonSerializer.Serialize(new { time = DateTimeOffset.UtcNow, stage, exceptions }) + "\n");
            }
            if (includeMessage && notify && Interlocked.Exchange(ref notified, 1) == 0)
                MessageBoxW(0, "校园余额启动失败。请查看日志：\n" + file, "校园余额", 0x10);
        }
        catch { /* Reporting must not replace the original exception. */ }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MessageBoxW(nint window, string text, string caption, uint type);
}
