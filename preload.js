"use strict";

const {
    contextBridge,
    ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
    "rpcManager",
    {
        getConfig: () =>
            ipcRenderer.invoke(
                "get-config"
            ),

        saveConfig: config =>
            ipcRenderer.invoke(
                "save-config",
                config
            ),

        exportConfig: () =>
            ipcRenderer.invoke(
                "export-config"
            ),

        importConfig: () =>
            ipcRenderer.invoke(
                "import-config"
            ),

        getConfigProfiles: () =>
            ipcRenderer.invoke(
                "get-config-profiles"
            ),

        saveConfigProfile: name =>
            ipcRenderer.invoke(
                "save-config-profile",
                name
            ),

        loadConfigProfile: name =>
            ipcRenderer.invoke(
                "load-config-profile",
                name
            ),

        deleteConfigProfile: name =>
            ipcRenderer.invoke(
                "delete-config-profile",
                name
            ),

        newConfig: () =>
            ipcRenderer.invoke(
                "new-config"
            ),

        start: () =>
            ipcRenderer.invoke(
                "start-rpc"
            ),

        stop: () =>
            ipcRenderer.invoke(
                "stop-rpc"
            ),

        refresh: () =>
            ipcRenderer.invoke(
                "refresh-rpc"
            ),

        getStatus: () =>
            ipcRenderer.invoke(
                "get-status"
            ),

        onStatus: callback => {
            ipcRenderer.on(
                "rpc-status",
                (_, data) => {
                    callback(data);
                }
            );
        },

        onNotification: callback => {
            ipcRenderer.on(
                "notification",
                (_, data) => {
                    callback(data);
                }
            );
        }
    }
);