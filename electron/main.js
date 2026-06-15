/**
 * Orbit Meeting — Electron Main Process
 *
 * Starts the Next.js production server (standalone build) and wraps it in a
 * native window. Runs Ollama availability check on first launch.
 */
const { app, BrowserWindow, dialog, ipcMain, shell, desktopCapturer } = require("electron");
const path = require("path");
const { fork } = require("child_process");

const isDev = !app.isPackaged;
// In dev mode, next dev is already running (started by the concurrently script).
// Use its port directly instead of starting a second server.
const DEV_SERVER_PORT = process.env.ELECTRON_DEV_PORT || 3000;
const PORT = isDev ? DEV_SERVER_PORT : (process.env.ELECTRON_PORT || 3456);

// ── Ollama check (first launch) ──────────────────────────────────────
const OLLAMA_CHECKED_KEY = "orbit.ollama-checked";

function detectOllama() {
  try {
    const cp = require("child_process");
    const result = cp.spawnSync("ollama", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function installOllama() {
  const platform = process.platform;
  if (platform === "darwin") {
    // macOS — prefer Homebrew (most devs have it), fallback to direct download
    try {
      const cp = require("child_process");
      const hasBrew = cp.spawnSync("brew", ["--version"], {
        encoding: "utf-8", timeout: 5000, stdio: "ignore",
      }).status === 0;

      if (hasBrew) {
        cp.execSync("brew install ollama", { stdio: "inherit", timeout: 120_000 });
        return true;
      }
    } catch {
      // fall through to direct download
    }
    // Direct download
    const { execSync } = require("child_process");
    execSync(
      "curl -fsSL https://ollama.com/install.sh | sh",
      { stdio: "inherit", timeout: 180_000 }
    );
    return true;
  } else if (platform === "linux") {
    const { execSync } = require("child_process");
    execSync(
      "curl -fsSL https://ollama.com/install.sh | sh",
      { stdio: "inherit", timeout: 180_000 }
    );
    return true;
  } else if (platform === "win32") {
    // Windows — download and run the installer silently
    const { execSync } = require("child_process");
    execSync(
      'powershell -Command "Start-BitsTransfer -Source https://ollama.com/download/OllamaSetup.exe -Destination %TEMP%\\OllamaSetup.exe; Start-Process %TEMP%\\OllamaSetup.exe -Wait -ArgumentList \'/SILENT\'"',
      { stdio: "inherit", timeout: 300_000 }
    );
    return true;
  }
  return false;
}

function showOllamaRecovery(win) {
  dialog.showMessageBox(win, {
    type: "info",
    title: "Ollama Not Found",
    message: "Orbit Meeting requires Ollama for local AI features.",
    detail:
      "Ollama lets you run language models locally on your machine.\n\n" +
      "• macOS: brew install ollama\n" +
      "  or visit https://ollama.com\n" +
      "• Windows: Download from https://ollama.com/download\n" +
      "• Linux: curl -fsSL https://ollama.com/install.sh | sh\n\n" +
      "After installing, restart Orbit Meeting.",
    buttons: ["Install Automatically", "Visit Ollama Website", "Skip"],
    defaultId: 0,
    cancelId: 2,
  }).then(({ response }) => {
    if (response === 0) {
      try {
        const success = installOllama();
        if (success) {
          dialog.showMessageBox(win, {
            type: "info",
            title: "Ollama Installed",
            message: "Ollama has been installed successfully!",
            detail: "Please restart Orbit Meeting to use local AI features.",
          });
        }
      } catch (e) {
        dialog.showMessageBox(win, {
          type: "error",
          title: "Installation Failed",
          message: "Could not install Ollama automatically.",
          detail:
            "Please install it manually:\n" +
            "  macOS: brew install ollama\n" +
            "  Windows: Download from https://ollama.com/download/OllamaSetup.exe\n" +
            "  Linux: curl -fsSL https://ollama.com/install.sh | sh",
        });
      }
    } else if (response === 1) {
      shell.openExternal("https://ollama.com");
    }
  });
}

// ── Next.js server management ────────────────────────────────────────
let serverProcess = null;

function startServer() {
  // In dev mode, next dev is already running on DEV_SERVER_PORT.
  // Don't start a second server — just wait briefly then resolve.
  if (isDev) {
    return new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const serverDir = isDev
    ? path.join(__dirname, "..")
    : path.join(process.resourcesPath, "app");

  const serverPath = isDev
    ? path.join(serverDir, "node_modules", ".bin", "next")
    : path.join(serverDir, "server.js");

  if (isDev) {
    serverProcess = fork(
      serverPath,
      ["start", "-p", String(PORT)],
      {
        cwd: serverDir,
        env: { ...process.env, PORT: String(PORT) },
        stdio: "pipe",
      }
    );
  } else {
    // Standalone build: server.js is at the root
    serverProcess = fork(serverPath, [], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "pipe",
    });
  }

  return new Promise((resolve) => {
    if (!serverProcess) return resolve();

    serverProcess.stdout?.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("started server") || msg.includes("listening on")) {
        resolve();
      }
    });

    // Timeout fallback — server might already be running
    setTimeout(resolve, isDev ? 8000 : 4000);
  });
}

// ── Window management ────────────────────────────────────────────────
let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Orbit Meeting",
    backgroundColor: "#0e0e10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Enable native screen sharing via desktopCapturer.
  // Without this, navigator.mediaDevices.getDisplayMedia throws
  // "Not supported" in Electron (Chromium lacks native getDisplayMedia).
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          callback({});
        }
      }, 3000);

      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
        });
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          if (sources && sources.length > 0) {
            callback({ video: sources[0], audio: "loopback" });
          } else {
            callback({});
          }
        }
      } catch {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          callback({});
        }
      }
    },
  );

  // Start Next.js server and load once ready
  await startServer();
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC handlers ─────────────────────────────────────────────────────

ipcMain.handle("dialog:saveFile", async (_event, options) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  return dialog.showSaveDialog(win, options);
});

ipcMain.handle("dialog:openDirectory", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  return dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
  });
});

ipcMain.handle("app:isPackaged", () => app.isPackaged);

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // First-launch Ollama check
  if (!isDev && !detectOllama()) {
    // We'll show the dialog after the window is ready, but store the intent
    globalThis._pendingOllamaCheck = true;
  }

  await createWindow();

  if (globalThis._pendingOllamaCheck && mainWindow) {
    showOllamaRecovery(mainWindow);
    globalThis._pendingOllamaCheck = false;
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
