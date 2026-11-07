NVideo Studio / Windows Explorer integration
==========================================
Scripts register the adjacent portable executable at:
  ..\nvideo-studio.exe

Run REGISTER_VIEWER.cmd after extracting your release.
Run STATUS_VIEWER.cmd to inspect your registration.
Run UNREGISTER_VIEWER.cmd to remove the app's commands.

No administrator rights are required. All changes are under HKCU.
Default-app selection remains a separate Windows Settings action.
Windows 11 may show these classic context menu entries in "Show more options".
Moving the portable folder requires registering again.
Do not use these scripts with the old v0.1.0 executable.
