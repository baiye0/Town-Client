using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Portal Desktop Setup")]
[assembly: AssemblyProduct("Portal Desktop")]

internal static class PortalDesktopSetup
{
    private const string ResourceName = "PortalDesktop.SetupCore.exe";
    private const string PackageResourceName = "PortalDesktop.PackageJson";
    private const string ProductName = "portal-desktop";
    private const string Title = "Portal Desktop \u5b89\u88c5";

    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = HasArgument(args, "--silent");
        string installRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), ProductName);
        string temporaryRoot = Path.Combine(Path.GetTempPath(), "portal-desktop-setup-" + Guid.NewGuid().ToString("N"));
        try
        {
            string targetVersion = ReadTargetVersion();
            string portalData = Environment.GetEnvironmentVariable("PORTAL_DESKTOP_USER_DATA");
            if (String.IsNullOrWhiteSpace(portalData)) portalData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Beings");
            string portalRoot = Path.Combine(portalData, "portal-service");
            bool clientRunning = HasClients(installRoot);
            bool portalRunning = HasPortalProcesses(portalRoot);
            if (clientRunning || portalRunning)
            {
                if (!silent && MessageBox.Show(
                    "\u68c0\u6d4b\u5230\u65e7\u5ba2\u6237\u7aef\u6216 Portal \u4ecd\u5728\u8fd0\u884c\u3002\u7ee7\u7eed\u5b89\u88c5\u5c06\u5148\u5b89\u5168\u5173\u95ed\u5b83\u4eec\uff0c\u662f\u5426\u7ee7\u7eed\uff1f",
                    Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return 0;

                if (clientRunning) RequestGracefulQuit(installRoot, targetVersion);
                bool stopped = WaitForClients(installRoot, TimeSpan.FromSeconds(15)) && WaitForPortalProcesses(portalRoot, TimeSpan.FromSeconds(15));
                if (!stopped)
                {
                    if (!silent && MessageBox.Show(
                        "\u65e7\u5ba2\u6237\u7aef\u6216 Portal \u672a\u80fd\u6b63\u5e38\u9000\u51fa\u3002\u662f\u5426\u5f3a\u5236\u5173\u95ed\u540e\u7ee7\u7eed\u5b89\u88c5\uff1f",
                        Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return 0;
                    StopClients(installRoot);
                    StopPortalProcesses(portalRoot);
                    if (!WaitForClients(installRoot, TimeSpan.FromSeconds(5)) || !WaitForPortalProcesses(portalRoot, TimeSpan.FromSeconds(5)))
                        throw new InvalidOperationException("The previous client or Portal is still running.");
                }
            }

            Directory.CreateDirectory(temporaryRoot);
            string core = Path.Combine(temporaryRoot, "Setup.exe");
            ExtractCore(core);
            Process installer = Process.Start(new ProcessStartInfo(core, JoinArguments(args)) { UseShellExecute = false });
            if (installer == null) throw new InvalidOperationException("Unable to start the installer.");
            installer.WaitForExit();
            if (installer.ExitCode != 0) throw new InvalidOperationException("Installation failed with exit code " + installer.ExitCode + ".");
            StartClient(installRoot);
            return 0;
        }
        catch (Exception error)
        {
            StartClient(installRoot);
            if (!silent) MessageBox.Show(
                "\u5b89\u88c5\u672a\u5b8c\u6210\uff1a" + error.Message,
                Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { Directory.Delete(temporaryRoot, true); } catch { }
        }
    }

    private static bool HasArgument(string[] args, string expected)
    {
        foreach (string value in args) if (String.Equals(value, expected, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static List<Process> FindClients(string installRoot)
    {
        string prefix = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        List<Process> result = new List<Process>();
        foreach (Process process in Process.GetProcessesByName(ProductName))
        {
            try
            {
                string executable = process.MainModule == null ? null : process.MainModule.FileName;
                if (executable != null && Path.GetFullPath(executable).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) result.Add(process);
                else process.Dispose();
            }
            catch { process.Dispose(); }
        }
        return result;
    }

    private static bool HasClients(string installRoot)
    {
        List<Process> running = FindClients(installRoot);
        bool found = running.Count > 0;
        foreach (Process process in running) process.Dispose();
        return found;
    }

    private static void RequestGracefulQuit(string installRoot, string targetVersion)
    {
        string launcher = Path.Combine(installRoot, ProductName + ".exe");
        if (!File.Exists(launcher)) return;
        try
        {
            Process process = Process.Start(new ProcessStartInfo(launcher, "--prepare-installer=" + targetVersion) { UseShellExecute = false, CreateNoWindow = true });
            if (process != null) process.Dispose();
        }
        catch { }
    }

    private static bool WaitForClients(string installRoot, TimeSpan timeout)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.Elapsed < timeout)
        {
            List<Process> running = FindClients(installRoot);
            bool empty = running.Count == 0;
            foreach (Process process in running) process.Dispose();
            if (empty) return true;
            Thread.Sleep(250);
        }
        List<Process> final = FindClients(installRoot);
        bool finished = final.Count == 0;
        foreach (Process process in final) process.Dispose();
        return finished;
    }

    private static void StopClients(string installRoot)
    {
        foreach (Process process in FindClients(installRoot))
        {
            try { process.Kill(); }
            catch { }
            finally { process.Dispose(); }
        }
    }

    private static bool HasPortalProcesses(string portalRoot)
    {
        string prefix = Path.GetFullPath(portalRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        bool found = false;
        foreach (Process process in Process.GetProcessesByName("heart-portal"))
        {
            try
            {
                string executable = process.MainModule == null ? null : process.MainModule.FileName;
                if (executable != null && Path.GetFullPath(executable).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) found = true;
            }
            catch { }
            finally { process.Dispose(); }
        }
        return found;
    }

    private static bool WaitForPortalProcesses(string portalRoot, TimeSpan timeout)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.Elapsed < timeout)
        {
            if (!HasPortalProcesses(portalRoot)) return true;
            Thread.Sleep(250);
        }
        return !HasPortalProcesses(portalRoot);
    }

    private static void StopPortalProcesses(string portalRoot)
    {
        string escaped = portalRoot.Replace("'", "''");
        string script = "$root='" + escaped + "'; " +
            "Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { @($_.Actions | Where-Object { $_.Arguments -like ('*' + $root + '*') }).Count -gt 0 } | ForEach-Object { Stop-ScheduledTask -InputObject $_ -ErrorAction SilentlyContinue }; " +
            "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'heart-portal.exe' -and $_.ExecutablePath -like ($root + '*')) -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like ('*' + $root + '*run.ps1*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        Process process = Process.Start(new ProcessStartInfo(powershell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + encoded) { UseShellExecute = false, CreateNoWindow = true });
        if (process == null) throw new InvalidOperationException("Unable to stop the previous Portal.");
        process.WaitForExit();
        int exitCode = process.ExitCode;
        process.Dispose();
        if (exitCode != 0) throw new InvalidOperationException("Unable to stop the previous Portal.");
    }

    private static void ExtractCore(string destination)
    {
        using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName))
        {
            if (input == null) throw new InvalidOperationException("Installer payload is missing.");
            using (FileStream output = File.Create(destination)) input.CopyTo(output);
        }
    }

    private static string ReadTargetVersion()
    {
        using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(PackageResourceName))
        {
            if (input == null) throw new InvalidOperationException("Installer version metadata is missing.");
            using (StreamReader reader = new StreamReader(input))
            {
                Match match = Regex.Match(reader.ReadToEnd(), "\\\"version\\\"\\s*:\\s*\\\"(\\d+\\.\\d+\\.\\d+)\\\"");
                if (!match.Success) throw new InvalidOperationException("Installer version metadata is invalid.");
                return match.Groups[1].Value;
            }
        }
    }

    private static void StartClient(string installRoot)
    {
        string updater = Path.Combine(installRoot, "Update.exe");
        if (!File.Exists(updater)) return;
        try
        {
            Process process = Process.Start(new ProcessStartInfo(updater, "--processStart " + ProductName + ".exe") { UseShellExecute = false, CreateNoWindow = true });
            if (process != null) process.Dispose();
        }
        catch { }
    }

    private static string JoinArguments(string[] args)
    {
        StringBuilder result = new StringBuilder();
        foreach (string value in args)
        {
            if (result.Length > 0) result.Append(' ');
            result.Append(QuoteArgument(value));
        }
        return result.ToString();
    }

    private static string QuoteArgument(string value)
    {
        if (value.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return value;
        StringBuilder result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { backslashes++; continue; }
            if (character == '"') result.Append('\\', backslashes * 2 + 1);
            else result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}
