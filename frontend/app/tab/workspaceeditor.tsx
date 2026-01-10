import { getApi } from "@/app/store/global";
import { fireAndForget, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "../element/button";
import { Input } from "../element/input";
import { WorkspaceService } from "../store/services";
import "./workspaceeditor.scss";

interface ColorSelectorProps {
    colors: string[];
    selectedColor?: string;
    onSelect: (color: string) => void;
    className?: string;
}

const ColorSelector = memo(function ColorSelector({
    colors,
    selectedColor,
    onSelect,
    className,
}: ColorSelectorProps) {
    return (
        <div className={clsx("color-selector", className)}>
            {colors.map((color) => (
                <div
                    key={color}
                    className={clsx("color-circle", { selected: selectedColor === color })}
                    style={{ backgroundColor: color }}
                    onClick={() => onSelect(color)}
                />
            ))}
        </div>
    );
});

interface IconSelectorProps {
    icons: string[];
    selectedIcon?: string;
    onSelect: (icon: string) => void;
    className?: string;
}

const IconSelector = memo(function IconSelector({
    icons,
    selectedIcon,
    onSelect,
    className,
}: IconSelectorProps) {
    return (
        <div className={clsx("icon-selector", className)}>
            {icons.map((icon) => {
                const iconClass = makeIconClass(icon, true);
                return (
                    <i
                        key={icon}
                        className={clsx(iconClass, "icon-item", { selected: selectedIcon === icon })}
                        onClick={() => onSelect(icon)}
                    />
                );
            })}
        </div>
    );
});

interface WorkspaceEditorProps {
    title: string;
    icon: string;
    color: string;
    directory: string;
    focusInput: boolean;
    onTitleChange: (newTitle: string) => void;
    onColorChange: (newColor: string) => void;
    onIconChange: (newIcon: string) => void;
    onDirectoryChange: (newDirectory: string) => void;
    onDeleteWorkspace: () => void;
}
export const WorkspaceEditor = memo(function WorkspaceEditor({
    title,
    icon,
    color,
    directory,
    focusInput,
    onTitleChange,
    onColorChange,
    onIconChange,
    onDirectoryChange,
    onDeleteWorkspace,
}: WorkspaceEditorProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    const [colors, setColors] = useState<string[]>([]);
    const [icons, setIcons] = useState<string[]>([]);

    useEffect(() => {
        fireAndForget(async () => {
            const fetchedColors = await WorkspaceService.GetColors();
            const fetchedIcons = await WorkspaceService.GetIcons();
            setColors(fetchedColors);
            setIcons(fetchedIcons);
        });
    }, []);

    useEffect(() => {
        if (focusInput && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [focusInput]);

    return (
        <div className="workspace-editor">
            <Input
                ref={inputRef}
                className={clsx("py-[3px]", { error: title === "" })}
                onChange={onTitleChange}
                value={title}
                autoFocus
                autoSelect
            />
            <ColorSelector selectedColor={color} colors={colors} onSelect={onColorChange} />
            <IconSelector selectedIcon={icon} icons={icons} onSelect={onIconChange} />
            <div className="directory-selector">
                <label className="directory-label">Directory</label>
                <div className="directory-input-row">
                    <Input
                        value={directory}
                        onChange={onDirectoryChange}
                        placeholder="~/projects/myworkspace"
                        className="directory-input"
                    />
                    <Button
                        className="ghost browse-btn"
                        onClick={async () => {
                            try {
                                const path = await getApi().showOpenFolderDialog();
                                if (path) {
                                    onDirectoryChange(path);
                                }
                            } catch (e) {
                                console.error("error opening folder dialog:", e);
                            }
                        }}
                    >
                        Browse
                    </Button>
                </div>
            </div>
            <div className="delete-ws-btn-wrapper">
                <Button className="ghost red text-[12px] bold" onClick={onDeleteWorkspace}>
                    Delete workspace
                </Button>
            </div>
        </div>
    );
});
