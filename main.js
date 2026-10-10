
"use strict";

const {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    Tray,
    Menu,
    nativeImage
} = require("electron");
const path = require("path");
const fs = require("fs");
const { Client: DiscordRPCClient } = require("@xhayper/discord-rpc");

const APP_NAME = "Discord Rich Presence Manager";
const VERSION = "1.0.1";
const ACTIVITY_TYPES = {
    playing: 0,
    listening: 2,
    watching: 3,
    competing: 5
};

const DEFAULT_CONFIG = {
    clientId: "",
    activityType: "playing",
    application: {
        details: "",
        state: "",
        largeImageKey: "",
        largeImageText: "",
        smallImageKey: "",
        smallImageText: "",
        timestamps: {
            enabled: true,
            mode: "elapsed",
            durationSeconds: 3600,
            resetOnRotation: false
        },
        party: {
            enabled: false,
            id: "",
            size: 1,
            max: 4
        },
        secrets: {
            enabled: false,
            join: "",
            spectate: "",
            match: ""
        },
        instance: false,
        buttons: []
    },
    rotation: {
        enabled: false,
        minSeconds: 300,
        maxSeconds: 600
    },
    presences: []
};

let mainWindow = null;
let rpc = null;
let connected = false;
let rotationTimer = null;
let tray = null;
let isQuitting = false;
let currentPresenceIndex = -1;
let startTimestamp = null;
let endTimestamp = null;
let configPath = null;
let config = null;

const dataDirectory = path.join(
    app.getPath("appData"),
    ".rootvex",
    APP_NAME
);
const profilesDirectory = path.join(dataDirectory, "configs");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(defaults, source) {
    if (Array.isArray(defaults)) {
        return Array.isArray(source) ? source : clone(defaults);
    }

    if (defaults && typeof defaults === "object") {
        const result = {};
        const sourceObject = source && typeof source === "object" && !Array.isArray(source)
            ? source
            : {};

        for (const key of Object.keys(defaults)) {
            result[key] = mergeDefaults(defaults[key], sourceObject[key]);
        }

        for (const key of Object.keys(sourceObject)) {
            if (!(key in result)) result[key] = sourceObject[key];
        }

        return result;
    }

    return source !== undefined ? source : clone(defaults);
}

function getConfigPath() {
    return path.join(dataDirectory, "config.json");
}

function ensureConfig() {
    if (!configPath) configPath = getConfigPath();
    if (!config) config = clone(DEFAULT_CONFIG);
    config = mergeDefaults(DEFAULT_CONFIG, config);
    return config;
}

function saveConfig() {
    ensureConfig();

    try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4), "utf8");
        return true;
    } catch (error) {
        console.error("Не удалось сохранить config.json:", error);
        return false;
    }
}

async function exportConfig() {
    ensureConfig();

    const result = await dialog.showSaveDialog(mainWindow, {
        title: "Экспорт конфигурации",
        defaultPath: "DRPM-config.json",
        filters: [{ name: "JSON configuration", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
    }

    try {
        fs.writeFileSync(result.filePath, JSON.stringify(config, null, 4), "utf8");
        return { success: true, path: result.filePath };
    } catch (error) {
        console.error("Failed to export configuration:", error);
        return { success: false, message: error.message };
    }
}

async function importConfig() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Импорт конфигурации",
        properties: ["openFile"],
        filters: [{ name: "JSON configuration", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePaths?.length) {
        return { success: false, canceled: true };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Файл не содержит корректную конфигурацию.");
        }

        config = mergeDefaults(DEFAULT_CONFIG, parsed);
        currentPresenceIndex = -1;
        startTimestamp = null;
        endTimestamp = null;
        saveConfig();

        if (connected) {
            await setPresence();
            scheduleRotation();
        }

        sendStatus();
        return { success: true, config: clone(config) };
    } catch (error) {
        console.error("Failed to import configuration:", error);
        return { success: false, message: error.message };
    }
}

function ensureProfilesDirectory() {
    fs.mkdirSync(profilesDirectory, { recursive: true });
}

function sanitizeProfileName(name) {
    return String(name || "")
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
        .replace(/\.+$/g, "")
        .slice(0, 64);
}

function getProfilePath(name) {
    const safeName = sanitizeProfileName(name);

    if (!safeName || safeName === "." || safeName === "..") return null;

    const resolvedDirectory = path.resolve(profilesDirectory);
    const profilePath = path.resolve(profilesDirectory, `${safeName}.json`);

    if (!profilePath.startsWith(resolvedDirectory + path.sep)) return null;

    return profilePath;
}

function listConfigProfiles() {
    ensureProfilesDirectory();

    return fs.readdirSync(profilesDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
        .map(entry => ({
            name: entry.name.slice(0, -5),
            filename: entry.name
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function saveConfigProfile(name) {
    const profilePath = getProfilePath(name);

    if (!profilePath) throw new Error("Invalid configuration name.");

    ensureProfilesDirectory();
    fs.writeFileSync(profilePath, JSON.stringify(ensureConfig(), null, 4), "utf8");

    return { success: true, name: sanitizeProfileName(name) };
}

function loadConfigProfile(name) {
    const profilePath = getProfilePath(name);

    if (!profilePath) throw new Error("Invalid configuration name.");
    if (!fs.existsSync(profilePath)) throw new Error("Configuration not found.");

    const parsed = JSON.parse(fs.readFileSync(profilePath, "utf8"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Configuration file contains invalid data.");
    }

    config = mergeDefaults(DEFAULT_CONFIG, parsed);
    currentPresenceIndex = -1;
    startTimestamp = null;
    endTimestamp = null;
    saveConfig();

    return clone(config);
}

function deleteConfigProfile(name) {
    const profilePath = getProfilePath(name);

    if (!profilePath) throw new Error("Invalid configuration name.");
    if (!fs.existsSync(profilePath)) throw new Error("Configuration not found.");

    fs.unlinkSync(profilePath);
    return { success: true };
}

function loadConfig() {
    configPath = getConfigPath();

    if (!fs.existsSync(configPath)) {
        config = clone(DEFAULT_CONFIG);
        saveConfig();
        return config;
    }

    try {
        const loaded = JSON.parse(fs.readFileSync(configPath, "utf8"));

        if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
            throw new Error("Некорректный формат конфигурации.");
        }

        config = mergeDefaults(DEFAULT_CONFIG, loaded);
        saveConfig();
        return config;
    } catch (error) {
        console.error("Не удалось загрузить config.json:", error);
        config = clone(DEFAULT_CONFIG);
        saveConfig();
        return config;
    }
}

function safeNumber(value, fallback, min = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.floor(number)) : fallback;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sendStatus() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("rpc-status", { connected });
    }
}

function sendNotification(type, message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("notification", { type, message });
    }
}

function randomPresenceIndex() {
    ensureConfig();

    if (!Array.isArray(config.presences) || config.presences.length === 0) {
        return -1;
    }

    const available = [-1, ...config.presences.map((_, index) => index)];

    if (available.length === 2) {
        return currentPresenceIndex === -1 ? available[1] : -1;
    }

    let index;

    do {
        index = available[Math.floor(Math.random() * available.length)];
    } while (index === currentPresenceIndex);

    return index;
}

function getCurrentPresence() {
    ensureConfig();

    if (!config.rotation.enabled || !Array.isArray(config.presences) || config.presences.length === 0) {
        currentPresenceIndex = -1;
        return config.application;
    }

    if (currentPresenceIndex === -1) return config.application;

    if (currentPresenceIndex < 0 || currentPresenceIndex >= config.presences.length) {
        currentPresenceIndex = -1;
        return config.application;
    }

    return config.presences[currentPresenceIndex];
}

function buildActivity(presence) {
    ensureConfig();

    const application = config.application;
    const activity = {};

    activity.type = ACTIVITY_TYPES[config.activityType] ?? 0;

    if (presence.details) activity.details = String(presence.details);
    if (presence.state) activity.state = String(presence.state);

    if (application.largeImageKey) activity.largeImageKey = String(application.largeImageKey);
    if (application.largeImageText && String(application.largeImageText).length >= 2) {
        activity.largeImageText = String(application.largeImageText);
    }

    if (application.smallImageKey) activity.smallImageKey = String(application.smallImageKey);
    if (application.smallImageText && String(application.smallImageText).length >= 2) {
        activity.smallImageText = String(application.smallImageText);
    }

    const timestamps = application.timestamps;

    if (timestamps) {
        if (timestamps.mode === "elapsed") {
            if (startTimestamp === null) startTimestamp = Date.now();
            activity.startTimestamp = startTimestamp;
        } else if (timestamps.mode === "remaining") {
            if (endTimestamp === null) {
                const duration = safeNumber(timestamps.durationSeconds, 3600, 3600);
                endTimestamp = Date.now() + duration * 1000;
            }

            activity.endTimestamp = endTimestamp;
        }
    }

    if (application.party?.enabled) {
        const party = application.party;

        if (party.id) activity.partyId = String(party.id);
        activity.partySize = safeNumber(party.size, 1, 0);
        activity.partyMax = safeNumber(party.max, 1, 0);
    }

    if (application.secrets?.enabled) {
        const secrets = application.secrets;

        if (secrets.join) activity.joinSecret = String(secrets.join);
        if (secrets.spectate) activity.spectateSecret = String(secrets.spectate);
        if (secrets.match) activity.matchSecret = String(secrets.match);
    }

    if (application.instance) activity.instance = true;

    if (Array.isArray(application.buttons)) {
        const buttons = application.buttons
            .filter(button => button && button.label && button.url)
            .slice(0, 2)
            .map(button => ({
                label: String(button.label),
                url: String(button.url)
            }));

        if (buttons.length) activity.buttons = buttons;
    }

    return activity;
}

async function setPresence() {
    if (!connected || !rpc || !rpc.user) return false;

    const presence = getCurrentPresence();
    if (!presence) return false;

    try {
        await rpc.user.setActivity(buildActivity(presence));
        return true;
    } catch (error) {
        console.error("Failed to set RPC activity:", error);
        sendNotification("error", `Ошибка Rich Presence: ${error.message}`);
        return false;
    }
}

function scheduleRotation() {
    clearTimeout(rotationTimer);
    rotationTimer = null;
    ensureConfig();

    if (!connected || !config.rotation.enabled || !Array.isArray(config.presences) || !config.presences.length) {
        return;
    }

    const min = safeNumber(config.rotation.minSeconds, 300, 1);
    const max = Math.max(min, safeNumber(config.rotation.maxSeconds, 600, min));
    const delay = randomInt(min, max);

    rotationTimer = setTimeout(async () => {
        if (!connected) return;

        currentPresenceIndex = randomPresenceIndex();

        if (config.application.timestamps.resetOnRotation) {
            startTimestamp = Date.now();
            endTimestamp = null;
        }

        await setPresence();
        scheduleRotation();
    }, delay * 1000);
}

async function connectRPC() {
    ensureConfig();

    if (connected) return true;

    if (!config.clientId) {
        sendNotification("error", "Укажите Application ID.");
        return false;
    }

    try {
        if (rpc) {
            try {
                await rpc.destroy();
            } catch {}
            rpc = null;
        }

        rpc = new DiscordRPCClient({ clientId: config.clientId });

        rpc.on("disconnected", () => {
            connected = false;
            clearTimeout(rotationTimer);
            rotationTimer = null;
            updateTrayMenu();
            sendStatus();
            sendNotification("info", "Discord отключён.");
        });

        rpc.on("error", error => {
            console.error("Discord RPC error:", error);
        });

        await rpc.login();

        connected = true;
        updateTrayMenu();

        startTimestamp = Date.now();
        endTimestamp = null;
        currentPresenceIndex = -1;

        if (!await setPresence()) {
            clearTimeout(rotationTimer);
            rotationTimer = null;

            try {
                await rpc.destroy();
            } catch {}

            rpc = null;
            connected = false;
            updateTrayMenu();
            sendStatus();
            sendNotification("error", "Discord подключён, но Rich Presence не удалось установить.");
            return false;
        }

        scheduleRotation();
        sendStatus();
        sendNotification("success", "Rich Presence запущен.");
        return true;
    } catch (error) {
        connected = false;
        clearTimeout(rotationTimer);
        rotationTimer = null;

        if (rpc) {
            try {
                await rpc.destroy();
            } catch {}
        }

        rpc = null;
        updateTrayMenu();
        sendStatus();

        console.error("Failed to connect to Discord:", error);
        sendNotification("error", `Не удалось подключиться к Discord: ${error.message}`);
        return false;
    }
}

async function disconnectRPC() {
    clearTimeout(rotationTimer);
    rotationTimer = null;

    if (!rpc) {
        connected = false;
        updateTrayMenu();
        sendStatus();
        return;
    }

    try {
        if (connected) await rpc.clearActivity();
    } catch {}

    try {
        await rpc.destroy();
    } catch {}

    rpc = null;
    connected = false;
    updateTrayMenu();
    sendStatus();
    sendNotification("info", "Rich Presence остановлен.");
}

function createTray() {
    if (tray) return;

    const iconPath = path.join(__dirname, "assets", "icon.ico");
    let trayIcon = nativeImage.createFromPath(iconPath);

    if (trayIcon.isEmpty()) {
        console.error("Failed to load tray icon:", iconPath);
        return;
    }

    trayIcon = trayIcon.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip(APP_NAME);
    updateTrayMenu();
    tray.on("double-click", showMainWindow);
}

function updateTrayMenu() {
    if (!tray) return;

    const statusText = connected ? "● RPC запущен" : "○ RPC остановлен";

    const rpcAction = connected
        ? {
            label: "Остановить RPC",
            click: async () => {
                await disconnectRPC();
                updateTrayMenu();
            }
        }
        : {
            label: "Запустить RPC",
            click: async () => {
                await connectRPC();
                updateTrayMenu();
            }
        };

    tray.setContextMenu(Menu.buildFromTemplate([
        { label: APP_NAME, enabled: false },
        { label: statusText, enabled: false },
        { type: "separator" },
        { label: "Открыть", click: showMainWindow },
        rpcAction,
        { type: "separator" },
        {
            label: "Выход",
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]));
}

function showMainWindow() {
    if (!mainWindow) {
        createWindow();
        return;
    }

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 1000,
        minHeight: 650,
        backgroundColor: "#0f1012",
        title: APP_NAME,
        icon: path.join(__dirname, "assets", "icon.ico"),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));

    mainWindow.on("close", event => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        } else {
            mainWindow = null;
        }
    });
}

ipcMain.handle("get-config", () => {
    ensureConfig();

    if (!fs.existsSync(configPath)) saveConfig();

    return clone(config);
});

ipcMain.handle("save-config", async (_, newConfig) => {
    if (!newConfig || typeof newConfig !== "object" || Array.isArray(newConfig)) {
        return { success: false, config: clone(ensureConfig()) };
    }

    config = mergeDefaults(DEFAULT_CONFIG, newConfig);
    const saved = saveConfig();

    if (connected) {
        await setPresence();
        scheduleRotation();
    }

    return { success: saved, config: clone(config) };
});

ipcMain.handle("start-rpc", async () => connectRPC());

ipcMain.handle("stop-rpc", async () => {
    await disconnectRPC();
    return true;
});

ipcMain.handle("refresh-rpc", async () => {
    if (!connected) return false;
    return setPresence();
});

ipcMain.handle("get-status", () => ({ connected }));

ipcMain.handle("export-config", async () => exportConfig());
ipcMain.handle("import-config", async () => importConfig());

ipcMain.handle("get-config-profiles", async () => {
    try {
        return { success: true, profiles: listConfigProfiles() };
    } catch (error) {
        console.error("Failed to list config profiles:", error);
        return { success: false, profiles: [], message: error.message };
    }
});

ipcMain.handle("save-config-profile", async (_, name) => {
    try {
        return saveConfigProfile(name);
    } catch (error) {
        console.error("Failed to save config profile:", error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle("load-config-profile", async (_, name) => {
    try {
        const loadedConfig = loadConfigProfile(name);

        if (connected) {
            await setPresence();
            scheduleRotation();
        }

        sendStatus();
        return { success: true, config: loadedConfig };
    } catch (error) {
        console.error("Failed to load config profile:", error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle("delete-config-profile", async (_, name) => {
    try {
        return deleteConfigProfile(name);
    } catch (error) {
        console.error("Failed to delete config profile:", error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle("new-config", async () => {
    config = clone(DEFAULT_CONFIG);
    currentPresenceIndex = -1;
    startTimestamp = null;
    endTimestamp = null;
    saveConfig();

    if (connected) {
        await setPresence();
        scheduleRotation();
    }

    sendStatus();
    return { success: true, config: clone(config) };
});

app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ensureProfilesDirectory();
    loadConfig();
    ensureConfig();

    createWindow();
    createTray();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("before-quit", () => {
    isQuitting = true;
    disconnectRPC();
    saveConfig();
});
