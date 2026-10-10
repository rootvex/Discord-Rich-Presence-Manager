"use strict";

let config = null;
let editingPresenceIndex = -1;
let discordConnected = false;

const pages = {
    presence: { title: "nav.main", description: "page.presence.description" },
    assets: { title: "nav.assets", description: "page.assets.description" },
    timestamp: { title: "nav.timestamp", description: "page.timestamp.description" },
    party: { title: "nav.party", description: "page.party.description" },
    secrets: { title: "nav.secrets", description: "page.secrets.description" },
    buttons: { title: "nav.buttons", description: "page.buttons.description" },
    rotation: { title: "nav.rotation", description: "page.rotation.description" },
    presences: { title: "nav.presences", description: "page.presences.description" },
    settings: { title: "nav.settings", description: "settings.description" }
};

const $ = id => document.getElementById(id);

const LANG_KEY = "drpm-language";

function applyLanguage(lang, notify = false) {
    if (!getAvailableLanguages().includes(lang)) lang = "ru";
    setLanguage(lang);
    setStartButton(discordConnected);

    const selector = $("language-select");
    if (selector) selector.value = lang;

    document.querySelectorAll(".nav-item.active").forEach(el => navigate(el.dataset.page));
    if (config) {
        updatePreview();
        renderPresenceList();
        updateConfigStatus();
    }
    if (notify) showToast(t("language.changed"));
}

function initializeLanguage() {
    let lang = "ru";
    try {
        lang = localStorage.getItem(LANG_KEY) || "ru";
    } catch {}

    applyLanguage(lang);

    $("language-select")?.addEventListener("change", e => {
        applyLanguage(e.target.value, true);
        try {
            localStorage.setItem(LANG_KEY, getLanguage());
        } catch {}
    });
}

function createDefaultConfig() {
    return {
        clientId: "",
        applicationName: "",
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
}

function createDefaultPresence(source = {}) {
    return {
        details: source.details || "",
        state: source.state || "",
        largeImageKey: source.largeImageKey || "",
        largeImageText: source.largeImageText || "",
        smallImageKey: source.smallImageKey || "",
        smallImageText: source.smallImageText || ""
    };
}

function normalizeConfig(source) {
    const defaults = createDefaultConfig();
    const result = { ...defaults, ...(source || {}) };
    const validActivityTypes = ["playing", "listening", "watching", "competing"];

    if (!validActivityTypes.includes(result.activityType)) {
        result.activityType = "playing";
    }

    result.application = {
        ...defaults.application,
        ...(source?.application || {})
    };

    result.application.timestamps = {
        ...defaults.application.timestamps,
        ...(source?.application?.timestamps || {})
    };

    if (!["elapsed", "remaining"].includes(result.application.timestamps.mode)) {
        result.application.timestamps.mode = "elapsed";
    }

    result.application.party = {
        ...defaults.application.party,
        ...(source?.application?.party || {})
    };

    result.application.secrets = {
        ...defaults.application.secrets,
        ...(source?.application?.secrets || {})
    };

    result.rotation = {
        ...defaults.rotation,
        ...(source?.rotation || {})
    };

    if (!Array.isArray(result.application.buttons)) {
        result.application.buttons = [];
    }

    result.presences = Array.isArray(result.presences)
        ? result.presences.map(presence => createDefaultPresence(presence))
        : [];

    return result;
}

function navigate(pageName) {
    if (!pages[pageName]) return;

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.page === pageName);
    });

    document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("active", page.id === `page-${pageName}`);
    });

    const keys = {
        presence: ["nav.main", "page.presence.description"],
        assets: ["nav.assets", "page.assets.description"],
        timestamp: ["nav.timestamp", "page.timestamp.description"],
        party: ["nav.party", "page.party.description"],
        secrets: ["nav.secrets", "page.secrets.description"],
        buttons: ["nav.buttons", "page.buttons.description"],
        rotation: ["nav.rotation", "page.rotation.description"],
        presences: ["nav.presences", "page.presences.description"],
        settings: ["nav.settings", "settings.description"]
    }[pageName];

    $("page-title").textContent = t(keys[0]);
    $("page-description").textContent = t(keys[1]);
}

function safeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

async function exportConfigFile() {
    updateConfigFromUI();
    const result = await window.rpcManager.exportConfig();

    if (!result || !result.success) {
        if (result?.canceled) return;
        showToast(result?.message || "Не удалось экспортировать конфигурацию.", "error");
        return;
    }

    showToast("Конфигурация экспортирована.", "success");
}

async function importConfigFile() {
    const result = await window.rpcManager.importConfig();

    if (!result || !result.success) {
        if (result?.canceled) return;
        showToast(result?.message || "Не удалось импортировать конфигурацию.", "error");
        return;
    }

    config = normalizeConfig(result.config);
    editingPresenceIndex = -1;
    loadUI();
    await refreshConfigProfiles();
    showToast("Конфигурация импортирована.", "success");
}

async function refreshConfigProfiles() {
    const select = document.getElementById("config-profile-select");
    if (!select) return;

    const result = await window.rpcManager.getConfigProfiles();

    if (!result || !result.success) {
        select.innerHTML = `<option value="">Failed to load configurations</option>`;
        return;
    }

    select.innerHTML = "";

    if (!result.profiles || result.profiles.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No saved configurations";
        select.appendChild(option);
        return;
    }

    for (const profile of result.profiles) {
        const option = document.createElement("option");
        option.value = profile.name;
        option.textContent = profile.name;
        select.appendChild(option);
    }
}

async function saveConfigProfile() {
    const input = document.getElementById("config-profile-name");
    if (!input) return;

    const name = input.value.trim();

    if (!name) {
        showToast("Введите название конфигурации.", "error");
        input.focus();
        return;
    }

    const result = await window.rpcManager.saveConfigProfile(name);

    if (!result || !result.success) {
        showToast(result?.message || "Не удалось сохранить конфигурацию.", "error");
        return;
    }

    input.value = "";
    await refreshConfigProfiles();

    const select = document.getElementById("config-profile-select");
    if (select) select.value = result.name;

    showToast(`Конфигурация "${result.name}" сохранена.`, "success");
}

async function loadConfigProfile() {
    const select = document.getElementById("config-profile-select");
    if (!select) return;

    const name = select.value;

    if (!name) {
        showToast("Выберите конфигурацию.", "error");
        return;
    }

    const result = await window.rpcManager.loadConfigProfile(name);

    if (!result || !result.success) {
        showToast(result?.message || "Не удалось загрузить конфигурацию.", "error");
        return;
    }

    config = normalizeConfig(result.config);
    editingPresenceIndex = -1;
    loadUI();

    showToast(`Конфигурация "${name}" загружена.`, "success");
}

async function deleteConfigProfile() {
    const select = document.getElementById("config-profile-select");
    if (!select) return;

    const name = select.value;

    if (!name) {
        showToast("Выберите конфигурацию.", "error");
        return;
    }

    const confirmed = window.confirm(`Удалить конфигурацию "${name}"?`);
    if (!confirmed) return;

    const result = await window.rpcManager.deleteConfigProfile(name);

    if (!result || !result.success) {
        showToast(result?.message || "Не удалось удалить конфигурацию.", "error");
        return;
    }

    await refreshConfigProfiles();
    showToast(`Конфигурация "${name}" удалена.`, "success");
}

async function createNewConfig() {
    const confirmed = window.confirm(
        "Создать новую пустую конфигурацию?\n\nНесохранённые изменения будут потеряны."
    );

    if (!confirmed) return;

    const result = await window.rpcManager.newConfig();

    if (!result || !result.success) {
        showToast(result?.message || "Не удалось создать конфигурацию.", "error");
        return;
    }

    config = normalizeConfig(result.config);
    editingPresenceIndex = -1;
    loadUI();

    showToast("Создана новая конфигурация.", "success");
}

function loadUI() {
    config = normalizeConfig(config);
    const app = config.application;

    $("clientId").value = config.clientId || "";
    $("applicationName").value = config.applicationName || "";
    $("details").value = app.details || "";
    $("state").value = app.state || "";
    $("largeImageKey").value = app.largeImageKey || "";
    $("largeImageText").value = app.largeImageText || "";
    $("smallImageKey").value = app.smallImageKey || "";
    $("smallImageText").value = app.smallImageText || "";
    $("timestampMode").value = app.timestamps.mode || "elapsed";
    $("resetTimestampOnRotation").checked = app.timestamps.resetOnRotation === true;

    $("durationSeconds").value = safeNumber(
        app.timestamps.durationSeconds,
        3600
    );

    $("partyEnabled").checked = !!app.party.enabled;
    $("partyId").value = app.party.id || "";
    $("partySize").value = safeNumber(app.party.size, 1);
    $("partyMax").value = safeNumber(app.party.max, 4);
    $("secretsEnabled").checked = !!app.secrets.enabled;
    $("joinSecret").value = app.secrets.join || "";
    $("spectateSecret").value = app.secrets.spectate || "";
    $("matchSecret").value = app.secrets.match || "";
    $("instance").checked = !!app.instance;

    const buttons = Array.isArray(app.buttons) ? app.buttons : [];

    $("button1Label").value = buttons[0]?.label || "";
    $("button1Url").value = buttons[0]?.url || "";
    $("button2Label").value = buttons[1]?.label || "";
    $("button2Url").value = buttons[1]?.url || "";

    $("rotationEnabled").checked = !!config.rotation.enabled;

    $("rotationMin").value = safeNumber(
        config.rotation.minSeconds,
        300
    );

    $("rotationMax").value = safeNumber(
        config.rotation.maxSeconds,
        600
    );

    $("activityType").value = config.activityType || "playing";

    updateDependentFields();
    updateCharacterCounters();
    updatePreview();
    renderPresenceList();
    updateConfigStatus();
}

function updateConfigFromUI() {
    config = normalizeConfig(config);
    const app = config.application;

    config.clientId = $("clientId").value.trim();
    config.applicationName = $("applicationName").value;
    app.details = $("details").value;
    app.state = $("state").value;
    app.largeImageKey = $("largeImageKey").value.trim();
    app.largeImageText = $("largeImageText").value;
    app.smallImageKey = $("smallImageKey").value.trim();
    app.smallImageText = $("smallImageText").value;
    app.timestamps.enabled = true;
    app.timestamps.mode = $("timestampMode").value;
    app.timestamps.resetOnRotation = $("resetTimestampOnRotation").checked;

    app.timestamps.durationSeconds = Math.max(
        3600,
        safeNumber($("durationSeconds").value, 3600)
    );

    app.party.enabled = $("partyEnabled").checked;
    app.party.id = $("partyId").value.trim();

    app.party.size = Math.max(
        0,
        safeNumber($("partySize").value, 1)
    );

    app.party.max = Math.max(
        0,
        safeNumber($("partyMax").value, 4)
    );

    app.secrets.enabled = $("secretsEnabled").checked;
    app.secrets.join = $("joinSecret").value;
    app.secrets.spectate = $("spectateSecret").value;
    app.secrets.match = $("matchSecret").value;
    app.instance = $("instance").checked;
    config.activityType = $("activityType").value;

    const buttons = [];
    const button1Label = $("button1Label").value.trim();
    const button1Url = $("button1Url").value.trim();
    const button2Label = $("button2Label").value.trim();
    const button2Url = $("button2Url").value.trim();

    if (button1Label || button1Url) {
        buttons.push({ label: button1Label, url: button1Url });
    }

    if (button2Label || button2Url) {
        buttons.push({ label: button2Label, url: button2Url });
    }

    app.buttons = buttons;

    config.rotation.enabled = $("rotationEnabled").checked;

    config.rotation.minSeconds = Math.max(
        1,
        safeNumber($("rotationMin").value, 300)
    );

    config.rotation.maxSeconds = Math.max(
        config.rotation.minSeconds,
        safeNumber($("rotationMax").value, 600)
    );

    updateDependentFields();
    updatePreview();
    updateCharacterCounters();
    updateConfigStatus();
}

function clearValidation() {
    document.querySelectorAll(".error").forEach(element => {
        element.classList.remove("error");
    });

    document.querySelectorAll(".field-error").forEach(element => {
        element.textContent = "";
        element.classList.remove("visible");
    });
}

function setFieldError(fieldId, message, errorId = null) {
    const field = $(fieldId);
    if (field) field.classList.add("error");

    if (errorId) {
        const error = $(errorId);

        if (error) {
            error.textContent = message;
            error.classList.add("visible");
        }
    }
}

function validateConfig() {
    updateConfigFromUI();
    clearValidation();

    let valid = true;

    if (!config.clientId) {
        setFieldError("clientId", "Application ID обязателен.", "clientIdError");
        valid = false;
    }

    if (config.application.party.enabled && !config.application.party.id) {
        setFieldError("partyId", "Party ID необходим, когда Party включён.");
        valid = false;
    }

    const buttons = config.application.buttons;

    for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        const labelId = i === 0 ? "button1Label" : "button2Label";
        const urlId = i === 0 ? "button1Url" : "button2Url";

        if (!button.label) {
            setFieldError(
                labelId,
                `Label кнопки ${i + 1} не может быть пустым.`
            );
            valid = false;
        }

        if (!button.url) {
            setFieldError(
                urlId,
                `URL кнопки ${i + 1} не может быть пустым.`
            );
            valid = false;
        } else {
            try {
                const url = new URL(button.url);

                if (
                    url.protocol !== "http:" &&
                    url.protocol !== "https:"
                ) {
                    throw new Error();
                }
            } catch {
                setFieldError(
                    urlId,
                    "URL должен начинаться с http:// или https://."
                );
                valid = false;
            }
        }
    }

    if (config.rotation.enabled && config.presences.length === 0) {
        valid = false;
        showToast("Rotation включён, но Presence List пуст.", "warning");
    }

    if (config.rotation.maxSeconds < config.rotation.minSeconds) {
        setFieldError(
            "rotationMax",
            "Maximum interval не может быть меньше Minimum interval."
        );
        valid = false;
    }

    updateConfigStatus();
    return valid;
}

function updateConfigStatus() {
    if (!config) return;
    const status = $("config-status");
    if (!status) return;
    const statusText = status.querySelector(".config-status-text") || status.querySelector("[data-i18n]");
    status.classList.remove("warning", "error");
    let key = "status.configReady";
    if (!config.clientId) {
        status.classList.add("error");
        key = "status.applicationIdRequired";
    } else if (config.rotation.enabled && config.presences.length === 0) {
        status.classList.add("warning");
        key = "status.rotationNeedsPresence";
    } else if (config.application.party.enabled && !config.application.party.id) {
        status.classList.add("warning");
        key = "status.partyIdRequired";
    }
    if (statusText) statusText.textContent = t(key);
}

async function saveConfig(showSuccessToast = true) {
    updateConfigFromUI();

    if (!validateConfig()) {
        showToast("Проверьте обязательные поля.", "error");
        return false;
    }

    try {
        const result = await window.rpcManager.saveConfig(config);

        if (!result || !result.success) {
            showToast(
                result?.message || "Не удалось сохранить конфигурацию.",
                "error"
            );
            return false;
        }

        if (result.config) {
            config = normalizeConfig(result.config);
        }

        if (showSuccessToast) showToast("Конфигурация сохранена.", "success");
        updatePreview();
        renderPresenceList();
        updateConfigStatus();

        return true;
    } catch (error) {
        console.error("Ошибка сохранения:", error);
        showToast(
            error?.message || "Не удалось сохранить конфигурацию.",
            "error"
        );
        return false;
    }
}

async function startRPC() {
    updateConfigFromUI();

    if (!validateConfig()) {
        showToast(
            "Нельзя запустить: исправьте ошибки конфигурации.",
            "error"
        );
        return;
    }

    const saved = await saveConfig(false);
    if (!saved) return;

    try {
        const result = await window.rpcManager.start();

        if (!result) {
            showToast("Не удалось подключиться к Discord.", "error");
        }
    } catch (error) {
        console.error("Ошибка запуска:", error);
        showToast("Ошибка запуска Rich Presence.", "error");
    }
}

async function stopRPC() {
    try {
        await window.rpcManager.stop();
        setStartButton(false);
        showToast("Rich Presence остановлен.", "success");
    } catch (error) {
        console.error("Ошибка остановки:", error);
        showToast("Не удалось остановить Rich Presence.", "error");
    }
}

function setStartButton(running) {
    const button = $("start-button");
    if (!button) return;
    button.dataset.running = String(running);
    button.textContent = t(running ? "rpc.stop" : "rpc.start");
    button.classList.toggle("danger", running);
    button.classList.toggle("primary", !running);
}

function setDependentState(containerId, enabled) {
    const container = $(containerId);
    if (!container) return;

    container.classList.toggle("disabled", !enabled);

    container.querySelectorAll("input, select").forEach(input => {
        input.disabled = !enabled;
    });
}

function updateDependentFields() {
    setDependentState("timestampFields", true);
    setDependentState("partyFields", $("partyEnabled").checked);
    setDependentState("secretsFields", $("secretsEnabled").checked);
    setDependentState("rotationFields", $("rotationEnabled").checked);
}

function updateSidebarPreview() {
    if (!config) return;

    const app = config.application;

    const sidebarType = $("sidebar-preview-type");
    if (sidebarType) {
        sidebarType.textContent = getActivityTypeLabel(config.activityType);
    }

    const application = $("sidebar-preview-application");
    if (application) {
        application.textContent =
            config.applicationName?.trim() || t("preview.applicationPlaceholder");
    }

    const details = $("sidebar-preview-details");
    if (details) {
        details.textContent = app.details?.trim() || t("preview.detailsPlaceholder");
    }

    const state = $("sidebar-preview-state");
    if (state) {
        state.textContent = app.state?.trim() || t("preview.statePlaceholder");
    }

    const largeImage = $("sidebar-large-image");
    if (largeImage) {
        largeImage.textContent = app.largeImageKey?.trim()
            ? app.largeImageKey.trim().substring(0, 8).toUpperCase()
            : "RP";
    }

    const smallImage = $("sidebar-small-image");
    if (smallImage) {
        if (app.smallImageKey?.trim()) {
            smallImage.classList.remove("hidden");
            smallImage.textContent = "●";
        } else {
            smallImage.classList.add("hidden");
        }
    }

    const time = $("sidebar-preview-time");
    if (time) {
        time.textContent = app.timestamps.mode === "remaining"
            ? formatDuration(app.timestamps.durationSeconds) + " " + t("timestamp.remaining")
            : "00:00 " + t("timestamp.elapsed");
    }

    const party = $("sidebar-preview-party");
    if (party) {
        if (app.party?.enabled) {
            party.classList.remove("hidden");

            const partyText = $("sidebar-party-text");
            if (partyText) {
                partyText.textContent =
                    `${app.party.size || 0} ${t("party.of")} ${app.party.max || 0}`;
            }
        } else {
            party.classList.add("hidden");
        }
    }

    const buttonsContainer = $("sidebar-preview-buttons");
    if (buttonsContainer) {
        buttonsContainer.innerHTML = "";

        const buttons = Array.isArray(app.buttons) ? app.buttons : [];

        buttons.slice(0, 2).forEach(button => {
            if (!button?.label) return;

            const element = document.createElement("div");
            element.className = "sidebar-preview-button";
            element.textContent = button.label;
            buttonsContainer.appendChild(element);
        });

        buttonsContainer.classList.toggle(
            "hidden",
            buttonsContainer.children.length === 0
        );
    }

    const features = $("sidebar-preview-features");
    if (features) {
        features.innerHTML = "";

        const addFeature = (text, warning = false) => {
            const badge = document.createElement("span");
            badge.className = "sidebar-preview-feature";

            if (warning) badge.classList.add("warning");

            badge.textContent = text;
            features.appendChild(badge);
        };

        addFeature(t("preview.feature.timestamp"));

        if (app.party?.enabled) {
            addFeature(t("preview.feature.party"));
        }

        if (app.secrets?.enabled) {
            addFeature(t("preview.feature.secrets"));
        }

        if (config.rotation?.enabled) {
            addFeature(
                config.presences.length > 0
                    ? t("preview.feature.rotation")
                    : t("preview.feature.rotationEmpty"),
                config.presences.length === 0
            );
        }

        features.classList.toggle("hidden", features.children.length === 0);
    }

    const statusDot = $("sidebar-preview-status");
    if (statusDot) {
        statusDot.classList.toggle("active", discordConnected);
    }
}

function formatDuration(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return (
            String(hours).padStart(2, "0") +
            ":" +
            String(minutes).padStart(2, "0") +
            ":" +
            String(secs).padStart(2, "0")
        );
    }

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(secs).padStart(2, "0")
    );
}

function updatePreview() {
    if (!config) return;

    const app = config.application;
    const previewType = $("preview-type");

    if (previewType) {
        previewType.textContent = getActivityTypeLabel(config.activityType);
    }

    $("preview-application").textContent =
        config.applicationName?.trim() || t("preview.applicationPlaceholder");

    $("preview-details").textContent =
        app.details?.trim() || t("preview.detailsPlaceholder");

    $("preview-state").textContent =
        app.state?.trim() || t("preview.statePlaceholder");

    if (app.timestamps.mode === "remaining") {
        $("preview-time").textContent =
            formatDuration(app.timestamps.durationSeconds) +
            " " + t("timestamp.remaining");
    } else {
        $("preview-time").textContent = "00:00 " + t("timestamp.elapsed");
    }

    updateSidebarPreview();
}

function getActivityTypeLabel(type) {
    const keys = {
        playing: "presence.playing",
        listening: "presence.listening",
        watching: "presence.watching",
        competing: "presence.competing"
    };

    return t(keys[type] || keys.playing);
}

function updateCharacterCounters() {
    document.querySelectorAll("[data-counter-for]").forEach(counter => {
        const target = $(counter.dataset.counterFor);
        if (!target) return;

        const max = target.maxLength > 0
            ? target.maxLength
            : 0;

        counter.textContent = `${target.value.length} / ${max}`;
    });
}

function renderPresenceList() {
    const list = $("presence-list");
    const empty = $("empty-presence-list");

    if (!list || !empty) return;

    list.innerHTML = "";

    const presences = Array.isArray(config.presences)
        ? config.presences
        : [];

    empty.style.display =
        presences.length === 0
            ? "flex"
            : "none";

    if (presences.length === 0) return;

    presences.forEach((presence, index) => {
        const item = document.createElement("div");
        item.className = "presence-item";

        const details = presence.details || t("presences.untitled");
        const state = presence.state || t("presences.noState");

        item.innerHTML = `
            <div class="presence-index">${String(index + 1).padStart(2, "0")}</div>
            <div class="presence-info">
                <div class="presence-title">${escapeHtml(details)}</div>
                <div class="presence-state">${escapeHtml(state)}</div>
            </div>
            <div class="presence-actions">
                <button class="icon-button" data-action="edit" data-index="${index}" title="${t("presences.edit")}">✎</button>
                <button class="icon-button delete" data-action="delete" data-index="${index}" title="${t("presences.delete")}">×</button>
            </div>
        `;

        list.appendChild(item);
    });
}

function openPresenceModal(index = -1) {
    editingPresenceIndex = index;
    const modal = $("presence-modal");
    const title = $("modal-title");
    let presence;
    if (index >= 0 && config.presences[index]) {
        presence = config.presences[index];
        title.textContent = t("modal.edit");
    } else {
        presence = createDefaultPresence({
            largeImageKey: config.application.largeImageKey || "",
            largeImageText: config.application.largeImageText || "",
            smallImageKey: config.application.smallImageKey || "",
            smallImageText: config.application.smallImageText || ""
        });
        title.textContent = t("modal.add");
    }
    $("modalDetails").value = presence.details || "";
    $("modalState").value = presence.state || "";
    $("modalLargeImageKey").value = presence.largeImageKey || "";
    $("modalLargeImageText").value = presence.largeImageText || "";
    $("modalSmallImageKey").value = presence.smallImageKey || "";
    $("modalSmallImageText").value = presence.smallImageText || "";
    modal.hidden = false;
    setTimeout(() => $("modalDetails").focus(), 50);
}

function closePresenceModal() {
    $("presence-modal").hidden = true;
    editingPresenceIndex = -1;
}

async function savePresenceFromModal() {
    const presence = {
        details: $("modalDetails").value,
        state: $("modalState").value,
        largeImageKey: $("modalLargeImageKey").value.trim(),
        largeImageText: $("modalLargeImageText").value,
        smallImageKey: $("modalSmallImageKey").value.trim(),
        smallImageText: $("modalSmallImageText").value
    };

    if (editingPresenceIndex >= 0) {
        config.presences[editingPresenceIndex] = presence;
    } else {
        config.presences.push(presence);
    }

    renderPresenceList();
    updateConfigStatus();
    closePresenceModal();
    await saveConfig();
}

function deletePresence(index) {
    const presence = config.presences[index];
    if (!presence) return;

    const name = presence.details || `Presence #${index + 1}`;

    if (!confirm(`Удалить "${name}"?`)) return;

    config.presences.splice(index, 1);
    renderPresenceList();
    updateConfigStatus();
    saveConfig();
}

function updateLivePreviewFromUI() {
    if (!config) return;
    updateConfigFromUI();
    updatePreview();
}


function updateDiscordStatus(data) {
    const status = $("status");
    if (!status) return;
    const connected = !!data?.connected;
    discordConnected = connected;
    status.classList.toggle("connected", connected);
    status.classList.toggle("disconnected", !connected);
    const statusText = status.querySelector("span:nth-child(2)");
    if (statusText) statusText.textContent = t(connected ? "rpc.connected" : "rpc.disconnected");
    $("sidebar-preview-status")?.classList.toggle("active", connected);
    setStartButton(connected);
}


function setupNavigation() {
    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", () => {
            navigate(button.dataset.page);
        });
    });
}

function setupInputEvents() {
    document.querySelectorAll("input, select").forEach(input => {
        input.addEventListener("input", () => {
            if (input.closest("#presence-modal")) return;

            updateConfigFromUI();
            updateCharacterCounters();
            updatePreview();
            updateConfigStatus();
        });

        input.addEventListener("change", () => {
            if (input.closest("#presence-modal")) return;

            updateConfigFromUI();
            updateDependentFields();
            updateCharacterCounters();
            updatePreview();
            updateConfigStatus();
        });
    });
}

function setupButtons() {
    $("save-button").addEventListener("click", saveConfig);

    $("start-button").addEventListener("click", async () => {
        const running = $("start-button").dataset.running === "true";

        if (running) {
            await stopRPC();
        } else {
            await startRPC();
        }
    });

    const saveProfileButton = document.getElementById("save-profile-button");
    if (saveProfileButton) {
        saveProfileButton.addEventListener("click", saveConfigProfile);
    }

    const loadProfileButton = document.getElementById("load-profile-button");
    if (loadProfileButton) {
        loadProfileButton.addEventListener("click", loadConfigProfile);
    }

    const deleteProfileButton = document.getElementById("delete-profile-button");
    if (deleteProfileButton) {
        deleteProfileButton.addEventListener("click", deleteConfigProfile);
    }

    const newConfigButton = document.getElementById("new-config-button");
    if (newConfigButton) {
        newConfigButton.addEventListener("click", createNewConfig);
    }

    const exportConfigButton = document.getElementById("export-config-button");
    if (exportConfigButton) {
        exportConfigButton.addEventListener("click", exportConfigFile);
    }

    const importConfigButton = document.getElementById("import-config-button");
    if (importConfigButton) {
        importConfigButton.addEventListener("click", importConfigFile);
    }

    $("addPresence").addEventListener("click", () => openPresenceModal());
    $("empty-add-presence").addEventListener("click", () => openPresenceModal());
    $("modal-close").addEventListener("click", closePresenceModal);
    $("modal-cancel").addEventListener("click", closePresenceModal);
    $("modal-save").addEventListener("click", savePresenceFromModal);

    $("presence-modal").addEventListener("click", event => {
        if (event.target === $("presence-modal")) {
            closePresenceModal();
        }
    });

    $("presence-list").addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;

        const index = Number(button.dataset.index);

        if (button.dataset.action === "edit") {
            openPresenceModal(index);
        }

        if (button.dataset.action === "delete") {
            deletePresence(index);
        }
    });
}

function setupKeyboard() {
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !$("presence-modal").hidden) {
            closePresenceModal();
        }

        if (event.ctrlKey && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveConfig();
        }
    });
}

function setupRPCEvents() {
    if (!window.rpcManager) {
        console.error("window.rpcManager is undefined.");
        showToast("RPC bridge не найден. Проверьте preload.js.", "error");
        return;
    }

    window.rpcManager.onStatus(data => {
        updateDiscordStatus(data);
    });

    window.rpcManager.onNotification(data => {
        if (!data) return;

        const message =
            data.message ||
            data.text ||
            String(data);

        const type = data.type || "success";
        showToast(message, type);
    });
}

async function initialize() {
    try {
        if (!window.rpcManager) {
            throw new Error("window.rpcManager is undefined");
        }

        config = await window.rpcManager.getConfig();
        config = normalizeConfig(config);
        loadUI();

        const status = await window.rpcManager.getStatus();
        updateDiscordStatus(status);
        await refreshConfigProfiles();
    } catch (error) {
        console.error("Initialization error:", error);
        config = createDefaultConfig();
        loadUI();
        showToast("Не удалось загрузить конфигурацию.", "error");
    }
}

initializeLanguage();
setupNavigation();
setupInputEvents();
setupButtons();
setupKeyboard();
setupRPCEvents();
initialize();