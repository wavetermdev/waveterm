// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { BookmarksModel, fileBookmarksAtom, type BookmarkEntry } from "@/app/store/bookmarksmodel";
import { modalsModel } from "@/app/store/modalmodel";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";

function EditBookmarksModal() {
    const entries = useAtomValue(fileBookmarksAtom);
    const model = BookmarksModel.getInstance();

    const move = (index: number, delta: number) => {
        const keys = entries.map((e) => e.key);
        const target = index + delta;
        if (target < 0 || target >= keys.length) {
            return;
        }
        [keys[index], keys[target]] = [keys[target], keys[index]];
        fireAndForget(() => model.reorder(keys));
    };

    const rename = (bm: BookmarkEntry, label: string) => {
        fireAndForget(() => model.update(bm.key, { label }));
    };

    return (
        <Modal onClose={() => modalsModel.popModal()}>
            <div className="flex flex-col gap-2 p-4 min-w-[420px]">
                <div className="text-lg font-bold">Edit Bookmarks</div>
                {entries.length == 0 && <div className="text-secondary">No bookmarks yet.</div>}
                {entries.map((bm, i) => (
                    <div key={bm.key} className="flex flex-row items-center gap-2">
                        <input
                            className="flex-1 bg-transparent border border-border rounded px-2 py-1"
                            defaultValue={bm.label}
                            onBlur={(e) => rename(bm, e.target.value)}
                        />
                        <span className="text-secondary text-xs truncate max-w-[140px]">{bm.path}</span>
                        <button className="cursor-pointer px-1" onClick={() => move(i, -1)} title="Move up">
                            ↑
                        </button>
                        <button className="cursor-pointer px-1" onClick={() => move(i, 1)} title="Move down">
                            ↓
                        </button>
                        <button
                            className="cursor-pointer px-1 text-error"
                            onClick={() => fireAndForget(() => model.remove(bm.key))}
                            title="Delete"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
        </Modal>
    );
}

EditBookmarksModal.displayName = "EditBookmarksModal";

export { EditBookmarksModal };
