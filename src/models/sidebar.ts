import { Model } from "./model";

export interface SidebarModel {
    readonly globalModel: Model;
    readonly tempWidth: OV<number>;
    readonly tempCollapsed: OV<boolean>;
    readonly isDragging: OV<boolean>;

    setTempWidthAndTempCollapsed(newWidth: number, newCollapsed: boolean): void;
    getWidth(ignoreCollapse?: boolean): number;
    getCollapsed(): boolean;
}
