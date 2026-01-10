// Copyright 2025, Command Line
// SPDX-License-Identifier: Apache-2.0

import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
} from "@/element/expandablemenu";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isLocalConnName, makeIconClass, shellQuoteForShellType, stringToBase64, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { Atom, atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { splitAtom } from "jotai/utils";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { CSSProperties, forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import { debounce } from "throttle-debounce";
import WorkspaceSVG from "../asset/workspace.svg";
import { IconButton } from "../element/iconbutton";
import { atoms, getAllBlockComponentModels, getApi, globalStore, pushFlashError } from "../store/global";
import { WorkspaceService } from "../store/services";
import { getObjectValue, makeORef } from "../store/wos";
import { waveEventSubscribe } from "../store/wps";
import { WorkspaceEditor } from "./workspaceeditor";
import "./workspaceswitcher.scss";

type WorkspaceListEntry = {
    windowId: string;
    workspace: Workspace;
};

type WorkspaceList = WorkspaceListEntry[];
const workspaceMapAtom = atom<WorkspaceList>([]);
const workspaceSplitAtom = splitAtom(workspaceMapAtom);
const editingWorkspaceAtom = atom<string>();
const WorkspaceSwitcher = forwardRef<HTMLDivElement>((_, ref) => {
    const setWorkspaceList = useSetAtom(workspaceMapAtom);
    const activeWorkspace = useAtomValueSafe(atoms.workspace);
    const workspaceList = useAtomValue(workspaceSplitAtom);
    const setEditingWorkspace = useSetAtom(editingWorkspaceAtom);

    const updateWorkspaceList = useCallback(async () => {
        const workspaceList = await WorkspaceService.ListWorkspaces();
        if (!workspaceList) {
            return;
        }
        const newList: WorkspaceList = [];
        for (const entry of workspaceList) {
            // This just ensures that the atom exists for easier setting of the object
            getObjectValue(makeORef("workspace", entry.workspaceid));
            newList.push({
                windowId: entry.windowid,
                workspace: await WorkspaceService.GetWorkspace(entry.workspaceid),
            });
        }
        setWorkspaceList(newList);
    }, []);

    useEffect(
        () =>
            waveEventSubscribe({
                eventType: "workspace:update",
                handler: () => fireAndForget(updateWorkspaceList),
            }),
        []
    );

    useEffect(() => {
        fireAndForget(updateWorkspaceList);
    }, []);

    const onDeleteWorkspace = useCallback((workspaceId: string) => {
        getApi().deleteWorkspace(workspaceId);
    }, []);

    const isActiveWorkspaceSaved = !!(activeWorkspace.name && activeWorkspace.icon);

    const workspaceIcon = isActiveWorkspaceSaved ? (
        <i className={makeIconClass(activeWorkspace.icon, false)} style={{ color: activeWorkspace.color }}></i>
    ) : (
        <WorkspaceSVG />
    );

    const saveWorkspace = () => {
        fireAndForget(async () => {
            await WorkspaceService.UpdateWorkspace(activeWorkspace.oid, "", "", "", "", true);
            await updateWorkspaceList();
            setEditingWorkspace(activeWorkspace.oid);
        });
    };

    return (
        <Popover
            className="workspace-switcher-popover"
            placement="bottom-start"
            onDismiss={() => setEditingWorkspace(null)}
            ref={ref}
        >
            <PopoverButton
                className="workspace-switcher-button grey"
                as="div"
                onClick={() => {
                    fireAndForget(updateWorkspaceList);
                }}
            >
                <span className="workspace-icon">{workspaceIcon}</span>
            </PopoverButton>
            <PopoverContent className="workspace-switcher-content">
                <div className="title">{isActiveWorkspaceSaved ? "Switch workspace" : "Open workspace"}</div>
                <OverlayScrollbarsComponent className={"scrollable"} options={{ scrollbars: { autoHide: "leave" } }}>
                    <ExpandableMenu noIndent singleOpen>
                        {workspaceList.map((entry, i) => (
                            <WorkspaceSwitcherItem key={i} entryAtom={entry} onDeleteWorkspace={onDeleteWorkspace} />
                        ))}
                    </ExpandableMenu>
                </OverlayScrollbarsComponent>

                <div className="actions">
                    {isActiveWorkspaceSaved ? (
                        <ExpandableMenuItem onClick={() => getApi().createWorkspace()}>
                            <ExpandableMenuItemLeftElement>
                                <i className="fa-sharp fa-solid fa-plus"></i>
                            </ExpandableMenuItemLeftElement>
                            <div className="content">Create new workspace</div>
                        </ExpandableMenuItem>
                    ) : (
                        <ExpandableMenuItem onClick={() => saveWorkspace()}>
                            <ExpandableMenuItemLeftElement>
                                <i className="fa-sharp fa-solid fa-floppy-disk"></i>
                            </ExpandableMenuItemLeftElement>
                            <div className="content">Save workspace</div>
                        </ExpandableMenuItem>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
});

/**
 * A ViewModel that has access to its block's ID and atom.
 */
interface BlockAwareViewModel extends ViewModel {
    blockId: string;
    blockAtom: Atom<Block>;
}

/**
 * A preview ViewModel with directory navigation capabilities.
 */
interface PreviewViewModel extends BlockAwareViewModel {
    goHistory: (path: string) => Promise<void>;
}

/**
 * Type guard that checks if a ViewModel has block awareness (blockId and blockAtom properties).
 */
function isBlockAwareViewModel(viewModel: ViewModel): viewModel is BlockAwareViewModel {
    return "blockId" in viewModel && "blockAtom" in viewModel;
}

/**
 * Type guard that checks if a ViewModel is a preview view with navigation capabilities.
 */
function isPreviewViewModel(viewModel: ViewModel): viewModel is PreviewViewModel {
    return viewModel.viewType === "preview" && isBlockAwareViewModel(viewModel) && "goHistory" in viewModel;
}

/**
 * Updates all local blocks to use a new workspace directory.
 * For preview blocks, navigates to the new directory.
 * For terminal blocks, sends a cd command to change to the new directory.
 * Skips blocks that have a remote connection.
 */
async function updateBlocksWithNewDirectory(newDirectory: string): Promise<void> {
    const allModels = getAllBlockComponentModels();
    for (const model of allModels) {
        if (model?.viewModel == null) {
            continue;
        }
        const viewModel = model.viewModel;
        if (!isBlockAwareViewModel(viewModel)) {
            continue;
        }
        const blockData = globalStore.get(viewModel.blockAtom);
        const connection = blockData?.meta?.connection;
        if (connection && !isLocalConnName(connection)) {
            continue;
        }
        if (isPreviewViewModel(viewModel)) {
            try {
                await viewModel.goHistory(newDirectory);
            } catch (e) {
                console.error("Failed to navigate preview block to new directory:", e);
                pushFlashError({
                    id: null,
                    icon: "triangle-exclamation",
                    title: "Directory Change Failed",
                    message: `Could not navigate preview to ${newDirectory}`,
                    expiration: null,
                });
            }
        } else if (viewModel.viewType === "term") {
            try {
                const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                    oref: makeORef("block", viewModel.blockId),
                });
                const shellType = rtInfo?.["shell:type"];
                const quotedDir = shellQuoteForShellType(newDirectory, shellType);
                const cdPrefix =
                    shellType === "bash" || shellType === "zsh" || shellType === "sh" || shellType === "fish"
                        ? "cd -- "
                        : "cd ";
                fireAndForget(async () => {
                    try {
                        await RpcApi.ControllerInputCommand(TabRpcClient, {
                            blockid: viewModel.blockId,
                            inputdata64: stringToBase64(`${cdPrefix}${quotedDir}\n`),
                        });
                    } catch (e) {
                        console.error("Failed to send cd command to terminal:", e);
                        // Optional: align UX with preview block failures
                        pushFlashError({
                            id: null,
                            icon: "triangle-exclamation",
                            title: "Directory Change Failed",
                            message: `Could not change terminal directory to ${newDirectory}`,
                            expiration: null,
                        });
                    }
                });
            } catch (e) {
                console.error("Failed to get shell type for terminal block:", e);
                pushFlashError({
                    id: null,
                    icon: "triangle-exclamation",
                    title: "Directory Change Failed",
                    message: `Could not change terminal directory to ${newDirectory}`,
                    expiration: null,
                });
            }
        }
    }
}

const WorkspaceSwitcherItem = ({
    entryAtom,
    onDeleteWorkspace,
}: {
    entryAtom: PrimitiveAtom<WorkspaceListEntry>;
    onDeleteWorkspace: (workspaceId: string) => void;
}) => {
    const activeWorkspace = useAtomValueSafe(atoms.workspace);
    const [workspaceEntry, setWorkspaceEntry] = useAtom(entryAtom);
    const [editingWorkspace, setEditingWorkspace] = useAtom(editingWorkspaceAtom);

    const workspace = workspaceEntry.workspace;
    const isCurrentWorkspace = activeWorkspace.oid === workspace.oid;

    const pendingDirectoryRef = useRef<string | null>(null);

    const debouncedBlockUpdate = useMemo(
        () =>
            debounce(300, (newDirectory: string) => {
                pendingDirectoryRef.current = null;
                fireAndForget(async () => {
                    await updateBlocksWithNewDirectory(newDirectory);
                });
            }),
        []
    );

    const debouncedWorkspaceUpdate = useMemo(
        () =>
            debounce(300, (oid: string, name: string, icon: string, color: string, directory: string) => {
                fireAndForget(async () => {
                    await WorkspaceService.UpdateWorkspace(oid, name, icon, color, directory, false);
                });
            }),
        []
    );

    useEffect(() => {
        return () => {
            debouncedBlockUpdate.cancel();
            debouncedWorkspaceUpdate.cancel();
            pendingDirectoryRef.current = null;
        };
    }, [debouncedBlockUpdate, debouncedWorkspaceUpdate]);

    const setWorkspace = useCallback(
        (newWorkspace: Workspace) => {
            setWorkspaceEntry((prev) => {
                const oldDirectory = prev.workspace.directory;
                const newDirectory = newWorkspace.directory;
                const directoryChanged = newDirectory !== oldDirectory;

                if (newWorkspace.name !== "") {
                    debouncedWorkspaceUpdate(
                        prev.workspace.oid,
                        newWorkspace.name,
                        newWorkspace.icon,
                        newWorkspace.color,
                        newWorkspace.directory ?? ""
                    );
                    if (directoryChanged && isCurrentWorkspace && newDirectory) {
                        pendingDirectoryRef.current = newDirectory;
                        debouncedBlockUpdate(newDirectory);
                    }
                }
                return { ...prev, workspace: newWorkspace };
            });
        },
        [debouncedBlockUpdate, debouncedWorkspaceUpdate, isCurrentWorkspace, setWorkspaceEntry]
    );

    const isActive = !!workspaceEntry.windowId;
    const editIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: "edit",
        icon: "pencil",
        title: "Edit workspace",
        click: (e) => {
            e.stopPropagation();
            if (editingWorkspace === workspace.oid) {
                setEditingWorkspace(null);
            } else {
                setEditingWorkspace(workspace.oid);
            }
        },
    };
    const windowIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: "window",
        noAction: true,
        icon: isCurrentWorkspace ? "check" : "window",
        title: isCurrentWorkspace ? "This is your current workspace" : "This workspace is open",
    };

    const isEditing = editingWorkspace === workspace.oid;

    return (
        <ExpandableMenuItemGroup
            key={workspace.oid}
            isOpen={isEditing}
            className={clsx({ "is-current": isCurrentWorkspace })}
        >
            <ExpandableMenuItemGroupTitle
                onClick={() => {
                    getApi().switchWorkspace(workspace.oid);
                    // Create a fake escape key event to close the popover
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
                }}
            >
                <div
                    className="menu-group-title-wrapper"
                    style={
                        {
                            "--workspace-color": workspace.color,
                        } as CSSProperties
                    }
                >
                    <ExpandableMenuItemLeftElement>
                        <i
                            className={clsx("left-icon", makeIconClass(workspace.icon, true))}
                            style={{ color: workspace.color }}
                        />
                    </ExpandableMenuItemLeftElement>
                    <div className="label">{workspace.name}</div>
                    <ExpandableMenuItemRightElement>
                        <div className="icons">
                            <IconButton decl={editIconDecl} />
                            {isActive && <IconButton decl={windowIconDecl} />}
                        </div>
                    </ExpandableMenuItemRightElement>
                </div>
            </ExpandableMenuItemGroupTitle>
            <ExpandableMenuItem>
                <WorkspaceEditor
                    title={workspace.name}
                    icon={workspace.icon}
                    color={workspace.color}
                    directory={workspace.directory ?? ""}
                    focusInput={isEditing}
                    onTitleChange={(title) => setWorkspace({ ...workspace, name: title })}
                    onColorChange={(color) => setWorkspace({ ...workspace, color })}
                    onIconChange={(icon) => setWorkspace({ ...workspace, icon })}
                    onDirectoryChange={(directory) => setWorkspace({ ...workspace, directory })}
                    onDeleteWorkspace={() => onDeleteWorkspace(workspace.oid)}
                />
            </ExpandableMenuItem>
        </ExpandableMenuItemGroup>
    );
};

export { WorkspaceSwitcher };
