// state.js

export const STORAGE_KEY = 'macroTrackerPro_State_v2';

// 1. Define safe structural defaults
const DEFAULT_STATE = {
    version: "2.0",
    settings: {
        onboardingComplete: false,
        goalWeight: 0,
        rate: "-1",
        isCalLocked: false
    },
    targets: {
        cal: 2000,
        p: 150,
        c: 200,
        f: 65
    },
    foodDatabase: [
        { id: 1, name: "Chicken Breast (Raw)", category: "Proteins", serving: 100, unit: "g", cal: 120, p: 22.5, c: 0, f: 2.6 },
        { id: 2, name: "Jasmine Rice (Dry)", category: "Carbs", serving: 45, unit: "g", cal: 160, p: 3, c: 36, f: 0 }
    ],
    weightLog: [],
    logs: {} // Sharded by YYYY-MM
};

// 2. The active in-memory state variable
export let appState = JSON.parse(JSON.stringify(DEFAULT_STATE));

// 3. State Mutation & Persistence
export function setAppState(newState) {
    appState = { ...DEFAULT_STATE, ...newState };
}

export function saveLocalState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
        console.error("Failed to save state to localStorage:", e);
    }
}

export function loadLocalState() {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (rawData) {
        try {
            const parsed = JSON.parse(rawData);
            setAppState(parsed);
            return true;
        } catch (e) {
            console.error("Failed to parse local state, falling back to default:", e);
        }
    }
    return false;
}

// 4. Import / Export Handlers (Your Data Ownership Engine)
export function exportUserData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `macro_tracker_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

export function importUserData(fileEvent) {
    return new Promise((resolve, reject) => {
        const file = fileEvent.target.files[0];
        if (!file) {
            reject(new Error("No file selected"));
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                // Basic validation: check if it has core keys
                if (!importedData.targets || !importedData.logs) {
                    throw new Error("Invalid backup file structure.");
                }
                setAppState(importedData);
                saveLocalState();
                resolve(true);
            } catch (err) {
                reject(err);
            }
        };
        reader.readAsText(file);
    });
}