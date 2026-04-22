/**
 * Electron main process for Bonaparte.
 *
 * Runs the Express server inside the main process, shows a single
 * BrowserWindow pointing at localhost, owns the system tray, handles
 * window-close ("keep in tray or quit?"), and exposes /api/version +
 * /api/run-update flows as native dialogs + child-process spawns.
 */
import { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage, ipcMain } from "electron";
import path from "path";
import os from "os";
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { startServer } from "../server.js";
import { VERSION, MANIFEST_RELATIVE, MANIFEST_FILE, INSTALLER_FILE } from "../lib/version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "bonaparte.ico")
  : path.join(__dirname, "..", "assets", "bonaparte.ico");

let mainWindow = null;
let tray = null;
let quittingForUpdate = false;
let quittingForReal = false;

// Single-instance lock so launching twice just focuses the running app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  openWindow();
});

function openWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Bonaparte",
    icon: nativeImage.createFromPath(ICON_PATH),
    autoHideMenuBar: true,
    backgroundColor: "#0f0f10",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(URL);

  mainWindow.on("close", (e) => {
    if (quittingForReal || quittingForUpdate) return; // allow close
    e.preventDefault();
    const { response } = dialog.showMessageBoxSync
      ? { response: dialog.showMessageBoxSync(mainWindow, {
          type: "question",
          buttons: ["Keep running in tray", "Quit Bonaparte"],
          defaultId: 0,
          cancelId: 0,
          title: "Bonaparte",
          message: "Close dashboard",
          detail: "Keep Bonaparte running in the system tray? The scheduler and Slack bot stay active.",
        }) }
      : { response: 0 };
    if (response === 1) {
      forceQuit();
    } else {
      mainWindow.hide();
    }
  });
}

function forceQuit() {
  quittingForReal = true;
  try { if (tray) { tray.destroy(); tray = null; } } catch {}
  // The Slack bot's websocket + scheduler intervals hold the Node event
  // loop open past app.quit(). Exit hard.
  app.exit(0);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Open dashboard", click: openWindow },
    { type: "separator" },
    { label: `Bonaparte ${VERSION}`, enabled: false },
    { type: "separator" },
    {
      label: "Check for updates",
      click: async () => {
        const info = readManifest();
        if (!info) {
          dialog.showMessageBox({ type: "info", message: "Update channel not available", detail: "The CN3 A/S OneDrive folder isn't synced on this machine." });
          return;
        }
        if (cmpSemver(info.version, VERSION) > 0) {
          promptInstallUpdate(info);
        } else {
          dialog.showMessageBox({ type: "info", message: "Bonaparte is up to date.", detail: `Current: ${VERSION}` });
        }
      },
    },
    { type: "separator" },
    { label: "Quit Bonaparte", click: forceQuit },
  ]);
}

function manifestDir() {
  return path.resolve(os.homedir(), ...MANIFEST_RELATIVE.split("/"));
}

function readManifest() {
  const p = path.join(manifestDir(), MANIFEST_FILE);
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, "utf8"));
    return { version: m.version, notes: m.notes || "" };
  } catch {
    return null;
  }
}

function cmpSemver(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function promptInstallUpdate(info) {
  const installer = path.join(manifestDir(), INSTALLER_FILE);
  if (!existsSync(installer)) {
    dialog.showMessageBox({
      type: "warning",
      message: "Update available, installer not synced yet",
      detail: `Version ${info.version} is ready but BonaparteSetup.exe hasn't synced to your OneDrive folder yet. Try again shortly.`,
    });
    return;
  }
  const { response } = { response: dialog.showMessageBoxSync({
    type: "question",
    buttons: ["Install now", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Bonaparte",
    message: `Update available: ${info.version}`,
    detail: (info.notes ? info.notes + "\n\n" : "") + "Bonaparte will close, run the installer, and reopen on the new version.",
  }) };
  if (response !== 0) return;

  quittingForUpdate = true;
  spawn(installer, [], { detached: true, stdio: "ignore" }).unref();
  app.quit();
}

function checkForUpdatesOnStartup() {
  const info = readManifest();
  if (!info) return;
  if (cmpSemver(info.version, VERSION) > 0) {
    // Defer so the main window is already loaded before the dialog pops.
    setTimeout(() => promptInstallUpdate(info), 3000);
  }
}

ipcMain.handle("bonaparte:version", () => {
  const info = readManifest();
  const installer = path.join(manifestDir(), INSTALLER_FILE);
  return {
    current: VERSION,
    latest: info?.version || null,
    notes: info?.notes || null,
    installerAvailable: existsSync(installer),
    hasUpdate: info ? cmpSemver(info.version, VERSION) > 0 : false,
  };
});

ipcMain.handle("bonaparte:run-update", () => {
  const info = readManifest();
  if (!info) return { ok: false, error: "No manifest" };
  promptInstallUpdate(info);
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    await startServer(PORT);
  } catch (err) {
    dialog.showErrorBox("Bonaparte failed to start", String(err));
    app.quit();
    return;
  }

  const trayIcon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(trayIcon);
  tray.setToolTip("Bonaparte");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", openWindow);

  openWindow();
  checkForUpdatesOnStartup();
});

// Keep the app alive when the window is hidden — tray is the owner.
app.on("window-all-closed", (e) => {
  if (!quittingForReal && !quittingForUpdate) e.preventDefault();
});
