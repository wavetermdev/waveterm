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

const ColorSelector = memo(({ colors, selectedColor, onSelect, className }: ColorSelectorProps) => {
    const handleColorClick = (color: string) => {
        onSelect(color);
    };

    return (
        <div className={clsx("color-selector", className)}>
            {colors.map((color) => (
                <div
                    key={color}
                    className={clsx("color-circle", { selected: selectedColor === color })}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorClick(color)}
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

const IconSelector = memo(({ icons, selectedIcon, onSelect, className }: IconSelectorProps) => {
    const handleIconClick = (icon: string) => {
        onSelect(icon);
    };

    return (
        <div className={clsx("icon-selector", className)}>
            {icons.map((icon) => {
                const iconClass = makeIconClass(icon, true);
                return (
                    <i
                        key={icon}
                        className={clsx(iconClass, "icon-item", { selected: selectedIcon === icon })}
                        onClick={() => handleIconClick(icon)}
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
    focusInput: boolean;
    onTitleChange: (newTitle: string) => void;
    onColorChange: (newColor: string) => void;
    onIconChange: (newIcon: string) => void;
    onDeleteWorkspace: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    isFirst?: boolean;
    isLast?: boolean;
}
const WorkspaceEditorComponent = ({
    title,
    icon,
    color,
    focusInput,
    onTitleChange,
    onColorChange,
    onIconChange,
    onDeleteWorkspace,
    onMoveUp,
    onMoveDown,
    isFirst,
    isLast,
}: WorkspaceEditorProps) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const [colors, setColors] = useState<string[]>([]);
    const [icons, setIcons] = useState<string[]>([]);

    useEffect(() => {
        fireAndForget(async () => {
            const colors = await WorkspaceService.GetColors();
            const icons = await WorkspaceService.GetIcons();
            setColors(colors);
            setIcons(icons);
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
            {(onMoveUp || onMoveDown) && (
                <div className="flex gap-2 mt-2">
                    <Button
                        className="ghost text-[12px]"
                        onClick={onMoveUp}
                        disabled={isFirst}
                        title="Move workspace up in list"
                    >
                        <i className="fa fa-arrow-up mr-1" />
                        Move Up
                    </Button>
                    <Button
                        className="ghost text-[12px]"
                        onClick={onMoveDown}
                        disabled={isLast}
                        title="Move workspace down in list"
                    >
                        <i className="fa fa-arrow-down mr-1" />
                        Move Down
                    </Button>
                </div>
            )}
            <div className="delete-ws-btn-wrapper">
                <Button className="ghost red text-[12px] bold" onClick={onDeleteWorkspace}>
                    Delete workspace
                </Button>
            </div>
        </div>
    );
};

export const WorkspaceEditor = memo(WorkspaceEditorComponent) as typeof WorkspaceEditorComponent;
