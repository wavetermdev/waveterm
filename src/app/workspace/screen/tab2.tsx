import React, { useRef } from "react";
import "./styles.less";

type ScreenTabProps = {
    name: string;
    onSelect: (tabName: string) => void;
    active: boolean;
    onDragStart: (name: string, ref: React.RefObject<HTMLDivElement>) => void;
};

const ScreenTab: React.FC<ScreenTabProps> = ({ name, onSelect, active, onDragStart }) => {
    const ref = useRef<HTMLDivElement>(null);

    return (
        <div
            ref={ref}
            className={`screen-tab ${active ? "active-screen-tab" : ""}`}
            onMouseDown={() => onDragStart(name, ref)}
            onClick={() => onSelect(name)}
            data-tab-name={name}
        >
            <div className="screen-tab-inner">{name}</div>
        </div>
    );
};

export { ScreenTab };
