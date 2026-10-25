' Opens Statement Sorter in its own app window (no tabs or address bar).
' Starts the background server first if it isn't already running.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

running = sh.Run("cmd /c netstat -ano | findstr /r /c:""127.0.0.2:80 .*LISTENING""", 0, True) = 0
If Not running Then
  sh.Run """" & dir & "\expensesort-server.cmd""", 0, False
  WScript.Sleep 2500
End If

browser = ""
For Each candidate In Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
    sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe")
  If browser = "" And fso.FileExists(candidate) Then browser = candidate
Next

If browser = "" Then
  sh.Run "http://expensesort"
Else
  sh.Run """" & browser & """ --app=http://expensesort --window-size=1320,900", 1, False
End If
