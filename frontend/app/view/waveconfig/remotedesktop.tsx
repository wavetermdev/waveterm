// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useEffect, useState } from "react";
import { localApi } from "./localapi";

type Session = { id: string; name: string; running: boolean; message: string };
const inputClass = "border border-border rounded p-2 bg-background text-foreground";
const buttonClass = "border border-border rounded px-3 py-2 hover:bg-secondary/30 disabled:opacity-50";
export const RemoteDesktopContent = memo(() => {
    const [protocol, setProtocol] = useState("rdp");
    const [host, setHost] = useState("");
    const [port, setPort] = useState(3389);
    const [username, setUsername] = useState("");
    const [domain, setDomain] = useState("");
    const [password, setPassword] = useState("");
    const [sessions, setSessions] = useState<Session[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        const refresh = () =>
            localApi<Session[]>("remote-desktop", undefined, controller.signal)
                .then(setSessions)
                .catch((e) => {
                    if (!controller.signal.aborted) setError(e.message);
                });
        void refresh();
        const timer = setInterval(refresh, 2000);
        return () => {
            controller.abort();
            clearInterval(timer);
        };
    }, []);
    const connect = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
            await localApi("remote-desktop", {
                action: "connect",
                profile: { name: host, protocol, host: host.trim(), port, username, domain },
                password,
            });
            setSessions(await localApi<Session[]>("remote-desktop"));
        } catch (e) {
            setError(e.message);
        } finally {
            setPassword("");
            setBusy(false);
        }
    };
    return (
        <div className="flex flex-col gap-4 p-6 overflow-y-auto h-full">
            <h2 className="text-lg font-semibold">Remote Desktops</h2>
            <p>
                Open RDP with FreeRDP or VNC with TigerVNC in a native viewer window. Requires a graphical desktop and
                an installed viewer.
            </p>
            <form className="flex flex-col gap-3" onSubmit={connect}>
                <label>
                    Protocol{" "}
                    <select
                        className={inputClass}
                        value={protocol}
                        onChange={(e) => {
                            setProtocol(e.target.value);
                            setPort(e.target.value === "rdp" ? 3389 : 5900);
                            setPassword("");
                        }}
                    >
                        <option value="rdp">RDP (xfreerdp)</option>
                        <option value="vnc">VNC (vncviewer)</option>
                    </select>
                </label>
                <label>
                    Host{" "}
                    <input
                        required
                        className={inputClass}
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="desktop.example.com"
                    />
                </label>
                <label>
                    Port{" "}
                    <input
                        required
                        type="number"
                        min={1}
                        max={65535}
                        className={inputClass}
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                    />
                </label>
                {protocol === "rdp" && (
                    <>
                        <label>
                            Username{" "}
                            <input
                                required
                                autoComplete="off"
                                className={inputClass}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </label>
                        <label>
                            Domain (optional){" "}
                            <input className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)} />
                        </label>
                        <label>
                            Password{" "}
                            <input
                                required
                                type="password"
                                autoComplete="off"
                                className={inputClass}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </label>
                    </>
                )}
                <p className="text-secondary text-sm">
                    RDP passwords are sent through stdin and cleared after launch. VNC asks for credentials in its own
                    window. FreeRDP verifies server certificates; configure a trusted certificate on your server.
                </p>
                <button disabled={busy} type="submit" className={buttonClass}>
                    Connect
                </button>
            </form>
            {error && (
                <p className="text-red-400" role="alert">
                    {error}
                </p>
            )}
            {sessions.map((s) => (
                <div key={s.id} className="border border-border rounded p-3 flex gap-3 items-center">
                    <span>
                        {s.name}: {s.message}
                    </span>
                    {s.running && (
                        <button
                            className={buttonClass}
                            onClick={() => {
                                void localApi("remote-desktop", { action: "stop", id: s.id }).catch((e) =>
                                    setError(e.message)
                                );
                            }}
                        >
                            Disconnect
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
});
RemoteDesktopContent.displayName = "RemoteDesktopContent";
