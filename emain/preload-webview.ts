// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from "electron";

// Geolocation polyfill that uses Wave's native location service
function setupGeolocationPolyfill() {
    const originalGeolocation = navigator.geolocation;

    // Track watch callbacks
    const watchCallbacks = new Map<number, { success: PositionCallback; error?: PositionErrorCallback }>();
    let watchIdCounter = 1;

    const waveGeolocation: Geolocation = {
        getCurrentPosition: (
            successCallback: PositionCallback,
            errorCallback?: PositionErrorCallback,
            options?: PositionOptions
        ) => {
            ipcRenderer
                .invoke("get-geolocation")
                .then((result: { success: boolean; position?: any; error?: string }) => {
                    if (result.success && result.position) {
                        const coords = {
                            latitude: result.position.latitude,
                            longitude: result.position.longitude,
                            accuracy: result.position.accuracy,
                            altitude: result.position.altitude ?? null,
                            altitudeAccuracy: result.position.altitudeAccuracy ?? null,
                            heading: result.position.heading ?? null,
                            speed: result.position.speed ?? null,
                            toJSON() {
                                return {
                                    latitude: this.latitude,
                                    longitude: this.longitude,
                                    accuracy: this.accuracy,
                                    altitude: this.altitude,
                                    altitudeAccuracy: this.altitudeAccuracy,
                                    heading: this.heading,
                                    speed: this.speed,
                                };
                            },
                        };
                        const position: GeolocationPosition = {
                            coords,
                            timestamp: Date.now(),
                            toJSON() {
                                return {
                                    coords: this.coords.toJSON(),
                                    timestamp: this.timestamp,
                                };
                            },
                        };
                        successCallback(position);
                    } else {
                        if (errorCallback) {
                            const error: GeolocationPositionError = {
                                code: 2, // POSITION_UNAVAILABLE
                                message: result.error || "Location unavailable",
                                PERMISSION_DENIED: 1,
                                POSITION_UNAVAILABLE: 2,
                                TIMEOUT: 3,
                            };
                            errorCallback(error);
                        }
                    }
                })
                .catch((err) => {
                    console.error("[wave-geolocation] IPC error:", err);
                    if (errorCallback) {
                        const error: GeolocationPositionError = {
                            code: 2,
                            message: err.message || "IPC error",
                            PERMISSION_DENIED: 1,
                            POSITION_UNAVAILABLE: 2,
                            TIMEOUT: 3,
                        };
                        errorCallback(error);
                    }
                });
        },

        watchPosition: (
            successCallback: PositionCallback,
            errorCallback?: PositionErrorCallback,
            options?: PositionOptions
        ): number => {
            const watchId = watchIdCounter++;
            watchCallbacks.set(watchId, { success: successCallback, error: errorCallback });

            // Initial position fetch
            waveGeolocation.getCurrentPosition(successCallback, errorCallback, options);

            // Set up periodic updates (every 30 seconds)
            const intervalId = setInterval(() => {
                if (watchCallbacks.has(watchId)) {
                    waveGeolocation.getCurrentPosition(successCallback, errorCallback, options);
                } else {
                    clearInterval(intervalId);
                }
            }, 30000);

            return watchId;
        },

        clearWatch: (watchId: number) => {
            watchCallbacks.delete(watchId);
        },
    };

    // Override navigator.geolocation
    Object.defineProperty(navigator, "geolocation", {
        value: waveGeolocation,
        writable: false,
        configurable: false,
    });

    console.log("[wave-geolocation] Polyfill installed");
}

// Install geolocation polyfill
try {
    setupGeolocationPolyfill();
} catch (e) {
    console.error("[wave-geolocation] Failed to install polyfill:", e);
}

document.addEventListener("contextmenu", (event) => {
    console.log("contextmenu event", event);
    if (event.target == null) {
        return;
    }
    const targetElement = event.target as HTMLElement;
    // Check if the right-click is on an image
    if (targetElement.tagName === "IMG") {
        setTimeout(() => {
            if (event.defaultPrevented) {
                return;
            }
            event.preventDefault();
            const imgElem = targetElement as HTMLImageElement;
            const imageUrl = imgElem.src;
            ipcRenderer.send("webview-image-contextmenu", { src: imageUrl });
        }, 50);
        return;
    }
    // do nothing
});

document.addEventListener("mouseup", (event) => {
    // Mouse button 3 = back, button 4 = forward
    if (!event.isTrusted) {
        return;
    }
    if (event.button === 3 || event.button === 4) {
        event.preventDefault();
        ipcRenderer.send("webview-mouse-navigate", event.button === 3 ? "back" : "forward");
    }
});

console.log("loaded wave preload-webview.ts");
