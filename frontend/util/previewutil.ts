import { createBlock, getApi } from "@/app/store/global";
import { makeNativeLabel } from "./platformutil";
import { fireAndForget } from "./util";
import { formatRemoteUri } from "./waveutil";

export function addOpenMenuItems(menu: ContextMenuItem[], conn: string, finfo: FileInfo): ContextMenuItem[] {
    if (!finfo) {
        return menu;
    }
    if (!conn) {
        // TODO:  resolve correct host path if connection is WSL
        // if the entry is a directory, reveal it in the file manager, if the entry is a file, reveal its parent directory
        menu.push({
            label: makeNativeLabel(true),
            click: () => {
                getApi().openNativePath(finfo.isdir ? finfo.path : finfo.dir);
            },
        });
        if (!finfo.isdir) {
            menu.push({
                label: makeNativeLabel(false),
                click: () => {
                    getApi().openNativePath(finfo.path);
                },
            });
        }
    }
    menu.push({
        label: "Open Terminal in New Block",
        click: () => {
            const termBlockDef: BlockDef = {
                meta: {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": formatRemoteUri(finfo.path, conn),
                    connection: conn,
                },
            };
            fireAndForget(() => createBlock(termBlockDef));
        },
    });
    return menu;
}
