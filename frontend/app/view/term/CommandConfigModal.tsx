import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS, atoms, globalStore } from "@/store/global";
import * as keyutil from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { useCallback, useMemo, useState } from "react";

import "./CommandConfigModal.scss";

interface CommandConfigModalProps {
    blockId: string;
}

function parseEnvText(text: string): { valid: boolean; map: Record<string, string>; error?: string } {
    const lines = text.split("\n");
    const map: Record<string, string> = {};
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "" || line.startsWith("#")) {
            continue;
        }
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0) {
            return { valid: false, map, error: `Invalid format on line ${i + 1}: use KEY=VALUE` };
        }
        const key = line.substring(0, eqIdx).trim();
        const value = line.substring(eqIdx + 1).trim();
        map[key] = value;
    }
    return { valid: true, map };
}

function envMapToText(envMap: Record<string, string> | undefined | null): string {
    if (!envMap) return "";
    return Object.entries(envMap)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
}

const CommandConfigModal = (props: CommandConfigModalProps) => {
    const { blockId } = props;
    const blockAtom = useMemo(() => WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)), [blockId]);
    const blockData = globalStore.get(blockAtom);

    const [command, setCommand] = useState(blockData?.meta?.["cmd"] ?? "");
    const [runOnStart, setRunOnStart] = useState(blockData?.meta?.["cmd:runonstart"] ?? true);
    const [clearOnStart, setClearOnStart] = useState(blockData?.meta?.["cmd:clearonstart"] ?? false);
    const [envText, setEnvText] = useState(envMapToText(blockData?.meta?.["cmd:env"]));
    const [saveDisabled, setSaveDisabled] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    const handleSaveAndRestart = useCallback(() => {
        const parsed = parseEnvText(envText);
        if (!parsed.valid) {
            setValidationError(parsed.error ?? "Invalid environment variables");
            return;
        }
        setValidationError(null);
        setSaveDisabled(true);
    const meta: Record<string, any> = {
        "cmd": command || null,
        "cmd:runonstart": !!runOnStart,
        "cmd:clearonstart": !!clearOnStart,
        "cmd:env": parsed.map,
        "controller": "shell",
    };
        fireAndForget(async () => {
            try {
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta,
                });
                await RpcApi.ControllerDestroyCommand(TabRpcClient, blockId);
                await RpcApi.ControllerResyncCommand(TabRpcClient, {
                    tabid: globalStore.get(atoms.staticTabId),
                    blockid: blockId,
                    forcerestart: true,
                });
            } catch (e) {
                console.error("Save & Restart failed:", e);
            }
            modalsModel.popModal();
        });
    }, [blockId, command, runOnStart, clearOnStart, envText]);

    const handleCancel = useCallback(() => {
        modalsModel.popModal();
    }, []);

    const handleKeyDown = useCallback(
        (waveEvent: WaveKeyboardEvent): boolean => {
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                handleCancel();
                return true;
            }
            return false;
        },
        [handleCancel]
    );

    return (
        <Modal
            className="pt-6 pb-4 px-5"
            onOk={handleSaveAndRestart}
            onCancel={handleCancel}
            onClose={handleCancel}
            okLabel="Save & Restart"
            cancelLabel="Cancel"
            okDisabled={saveDisabled}
        >
            <div className="font-bold text-primary mx-4 pb-2.5">Startup Command</div>
            <div className="flex flex-col gap-4 mx-4 mb-4 min-w-[450px] text-primary">
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Command</label>
                    <textarea
                        className="w-full bg-panel rounded-md border border-border py-1.5 px-3 font-mono text-sm resize-y focus:ring-2 focus:ring-accent focus:outline-none"
                        rows={8}
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                        placeholder="Enter command to run on startup (leave empty for interactive shell)"
                    />
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={runOnStart}
                            onChange={(e) => setRunOnStart(e.target.checked)}
                            className="accent-accent cursor-pointer"
                        />
                        <span className="text-sm">Run on startup</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={clearOnStart}
                            onChange={(e) => setClearOnStart(e.target.checked)}
                            className="accent-accent cursor-pointer"
                        />
                        <span className="text-sm">Clear output on start</span>
                    </label>
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Environment Variables</label>
                    <textarea
                        className="w-full bg-panel rounded-md border border-border py-1.5 px-3 font-mono text-sm resize-y focus:ring-2 focus:ring-accent focus:outline-none"
                        rows={4}
                        value={envText}
                        onChange={(e) => {
                            setValidationError(null);
                            setEnvText(e.target.value);
                        }}
                        onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                        placeholder="KEY=VALUE (one per line)"
                    />
                    {validationError && (
                        <span className="text-red-500 text-xs">{validationError}</span>
                    )}
                </div>
            </div>
        </Modal>
    );
};

CommandConfigModal.displayName = "CommandConfigModal";

export { CommandConfigModal };
