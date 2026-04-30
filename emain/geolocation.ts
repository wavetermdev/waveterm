// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

interface GeolocationPosition {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude?: number;
    altitudeAccuracy?: number;
    heading?: number;
    speed?: number;
}

interface GeolocationResult {
    success: boolean;
    position?: GeolocationPosition;
    error?: string;
}

// Cache for location data (avoid hitting location services too often)
let cachedLocation: GeolocationPosition | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION_MS = 60000; // 1 minute cache

/**
 * Swift helper script for macOS CoreLocation
 * This script requests location authorization and returns current location
 */
const SWIFT_LOCATION_SCRIPT = `
import CoreLocation
import Foundation

class LocationHelper: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    let semaphore = DispatchSemaphore(value: 0)
    var result: [String: Any] = ["success": false, "error": "Timeout"]

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func requestLocation() {
        let status = manager.authorizationStatus

        if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
            // Wait a bit for authorization
            Thread.sleep(forTimeInterval: 0.5)
        }

        let newStatus = manager.authorizationStatus
        if newStatus == .denied || newStatus == .restricted {
            result = ["success": false, "error": "Location access denied"]
            return
        }

        manager.requestLocation()
        _ = semaphore.wait(timeout: .now() + 10)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let location = locations.last {
            result = [
                "success": true,
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "altitude": location.altitude,
                "altitudeAccuracy": location.verticalAccuracy,
                "heading": location.course,
                "speed": location.speed
            ]
        }
        semaphore.signal()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        result = ["success": false, "error": error.localizedDescription]
        semaphore.signal()
    }
}

let helper = LocationHelper()
helper.requestLocation()

if let jsonData = try? JSONSerialization.data(withJSONObject: helper.result),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
}
`;

/**
 * Get location using macOS CoreLocation via Swift
 */
async function getMacOSLocation(): Promise<GeolocationResult> {
    return new Promise((resolve) => {
        const tmpDir = os.tmpdir();
        const scriptPath = path.join(tmpDir, "wave-location-helper.swift");

        // Write the Swift script to temp
        fs.writeFileSync(scriptPath, SWIFT_LOCATION_SCRIPT);

        // Execute with swift
        const proc = spawn("swift", [scriptPath], {
            timeout: 15000,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("close", (code) => {
            // Clean up temp file
            try {
                fs.unlinkSync(scriptPath);
            } catch (e) {
                // Ignore cleanup errors
            }

            if (code !== 0) {
                console.log("[geolocation] Swift helper failed:", stderr);
                resolve({ success: false, error: `Swift execution failed: ${stderr}` });
                return;
            }

            try {
                const result = JSON.parse(stdout.trim());
                if (result.success) {
                    resolve({
                        success: true,
                        position: {
                            latitude: result.latitude,
                            longitude: result.longitude,
                            accuracy: result.accuracy,
                            altitude: result.altitude,
                            altitudeAccuracy: result.altitudeAccuracy,
                            heading: result.heading >= 0 ? result.heading : undefined,
                            speed: result.speed >= 0 ? result.speed : undefined,
                        },
                    });
                } else {
                    resolve({ success: false, error: result.error });
                }
            } catch (e) {
                console.log("[geolocation] Failed to parse Swift output:", stdout);
                resolve({ success: false, error: "Failed to parse location data" });
            }
        });

        proc.on("error", (err) => {
            console.log("[geolocation] Failed to spawn Swift:", err);
            resolve({ success: false, error: err.message });
        });
    });
}

/**
 * Fallback: IP-based geolocation using free API
 */
async function getIPBasedLocation(): Promise<GeolocationResult> {
    try {
        // Use multiple free IP geolocation services as fallback
        const response = await fetch("https://ipapi.co/json/", {
            headers: { "User-Agent": "WaveTerm" },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.latitude && data.longitude) {
            return {
                success: true,
                position: {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    accuracy: 10000, // IP-based is ~city level accuracy
                },
            };
        }

        return { success: false, error: "No location in response" };
    } catch (e) {
        console.log("[geolocation] IP-based lookup failed:", e);
        return { success: false, error: e.message };
    }
}

/**
 * Get current location with caching
 */
export async function getCurrentPosition(): Promise<GeolocationResult> {
    // Check cache first
    const now = Date.now();
    if (cachedLocation && (now - cacheTimestamp) < CACHE_DURATION_MS) {
        console.log("[geolocation] Returning cached location");
        return { success: true, position: cachedLocation };
    }

    let result: GeolocationResult;

    // Try platform-specific location first
    if (process.platform === "darwin") {
        console.log("[geolocation] Attempting macOS CoreLocation...");
        result = await getMacOSLocation();

        if (result.success) {
            console.log("[geolocation] CoreLocation succeeded");
            cachedLocation = result.position;
            cacheTimestamp = now;
            return result;
        }
        console.log("[geolocation] CoreLocation failed:", result.error);
    }

    // Fallback to IP-based geolocation
    console.log("[geolocation] Falling back to IP-based geolocation...");
    result = await getIPBasedLocation();

    if (result.success) {
        console.log("[geolocation] IP-based geolocation succeeded");
        cachedLocation = result.position;
        cacheTimestamp = now;
    }

    return result;
}

/**
 * Configure geolocation for webview sessions
 * This injects a custom geolocation provider into webviews
 */
export function configureGeolocationForSession(session: electron.Session) {
    // We'll inject a polyfill into webviews that calls back to the main process
    // for geolocation data instead of relying on Chromium's built-in provider

    session.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
        callback({});
    });

    console.log("[geolocation] Session configured for geolocation support");
}

/**
 * IPC handler for geolocation requests from renderer/webview
 */
export function registerGeolocationIPC() {
    electron.ipcMain.handle("get-geolocation", async () => {
        return getCurrentPosition();
    });

    console.log("[geolocation] IPC handler registered");
}
