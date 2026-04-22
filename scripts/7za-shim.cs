// Wraps 7za-real.exe. If the real process exits with code 2 but every
// stderr line is a symbolic-link privilege error, treat it as success —
// electron-builder doesn't actually need the macOS dylib symlinks when
// building a Windows installer.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

internal static class Shim {
    private static int Main(string[] args) {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string real = Path.Combine(dir, "7za-real.exe");

        var psi = new ProcessStartInfo(real) {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
            CreateNoWindow = true,
        };
        foreach (var a in args) {
            if (psi.Arguments.Length > 0) psi.Arguments += " ";
            psi.Arguments += QuoteIfNeeded(a);
        }

        var stderr = new StringBuilder();
        var p = Process.Start(psi);
        p.OutputDataReceived += (_, e) => { if (e.Data != null) Console.Out.WriteLine(e.Data); };
        p.ErrorDataReceived  += (_, e) => {
            if (e.Data == null) return;
            Console.Error.WriteLine(e.Data);
            stderr.AppendLine(e.Data);
        };
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();

        int code = p.ExitCode;
        if (code == 2) {
            string errs = stderr.ToString();
            // Every non-empty, non-boilerplate line must be a symlink error.
            bool onlySymlink = true;
            foreach (var raw in errs.Split('\n')) {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.IndexOf("Cannot create symbolic link", StringComparison.Ordinal) >= 0) continue;
                onlySymlink = false;
                break;
            }
            if (onlySymlink) return 0;
        }
        return code;
    }

    private static string QuoteIfNeeded(string s) {
        if (s.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return s;
        return "\"" + s.Replace("\"", "\\\"") + "\"";
    }
}
