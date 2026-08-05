Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Rm {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
    public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
    public string strServiceShortName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint pSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

  public static void WhoLocks(string path) {
    Console.WriteLine("=== " + path + " ===");
    uint handle;
    string key = Guid.NewGuid().ToString();
    if (RmStartSession(out handle, 0, key) != 0) { Console.WriteLine("RmStartSession failed"); return; }
    try {
      string[] resources = new string[] { path };
      if (RmRegisterResources(handle, (uint)resources.Length, resources, 0, IntPtr.Zero, 0, null) != 0) {
        Console.WriteLine("RmRegisterResources failed"); return;
      }
      uint pnProcInfoNeeded = 0, pnProcInfo = 0, lpdwRebootReasons = 0;
      int res = RmGetList(handle, out pnProcInfoNeeded, ref pnProcInfo, null, ref lpdwRebootReasons);
      if (res == 234) {
        pnProcInfo = pnProcInfoNeeded;
        RM_PROCESS_INFO[] arr = new RM_PROCESS_INFO[pnProcInfo];
        res = RmGetList(handle, out pnProcInfoNeeded, ref pnProcInfo, arr, ref lpdwRebootReasons);
        if (res == 0) {
          foreach (var info in arr) {
            Console.WriteLine("PID=" + info.Process.dwProcessId + " APP=" + info.strAppName);
            try {
              var p = System.Diagnostics.Process.GetProcessById(info.Process.dwProcessId);
              Console.WriteLine("  Name=" + p.ProcessName);
              try { Console.WriteLine("  Path=" + p.MainModule.FileName); } catch {}
            } catch (Exception ex) { Console.WriteLine("  (detail) " + ex.Message); }
          }
        } else Console.WriteLine("RmGetList2 failed " + res);
      } else if (res == 0 && pnProcInfoNeeded == 0) {
        Console.WriteLine("No locking processes reported");
      } else {
        Console.WriteLine("RmGetList failed " + res + " needed=" + pnProcInfoNeeded);
      }
    } finally { RmEndSession(handle); }
  }
}
"@

[Rm]::WhoLocks("D:\sistemas\GestorVend\apps\desktop\dist-installer\win-unpacked\resources\app.asar")
[Rm]::WhoLocks("D:\sistemas\GestorVend\apps\desktop\dist-installer")
