// ExpandableMenu.tsx
import { clsx } from "clsx";
import { Children, ReactElement, ReactNode, cloneElement, useState } from "react";

import "./expandablemenu.less";

type BaseExpandableMenuItem = {
    id: string;
    type: "item" | "group";
};

interface ExpandableMenuItemType extends BaseExpandableMenuItem {
    type: "item";
    leftElement?: string | ReactNode;
    rightElement?: string | ReactNode;
    content?: React.ReactNode;
}

interface ExpandableMenuItemGroupTitleType {
    leftElement?: string | ReactNode;
    label: string;
    rightElement?: string | ReactNode;
}

interface ExpandableMenuItemGroupType extends BaseExpandableMenuItem {
    type: "group";
    title: ExpandableMenuItemGroupTitleType;
    defaultExpanded?: boolean;
    children?: ExpandableMenuItemData[];
}

type ExpandableMenuItemData = ExpandableMenuItemType | ExpandableMenuItemGroupType;

type ExpandableMenuProps = {
    children: React.ReactNode;
    className?: string;
    noIndent?: boolean;
};

const ExpandableMenu = ({ children, className, noIndent = false }: ExpandableMenuProps) => {
    return <div className={clsx("expandable-menu", className, { "no-indent": noIndent === true })}>{children}</div>;
};

type ExpandableMenuItemProps = {
    children: ReactNode;
    className?: string;
    withHoverEffect?: boolean;
    onClick?: () => void;
};

const ExpandableMenuItem = ({ children, className, withHoverEffect = true, onClick }: ExpandableMenuItemProps) => {
    return (
        <div
            className={clsx("expandable-menu-item", className, {
                "with-hover-effect": withHoverEffect === true,
            })}
            onClick={onClick}
        >
            {children}
        </div>
    );
};

type ExpandableMenuItemGroupTitleProps = {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
};

const ExpandableMenuItemGroupTitle = ({ children, className, onClick }: ExpandableMenuItemGroupTitleProps) => {
    return (
        <div className={clsx("expandable-menu-item-group-title", className)} onClick={() => onClick?.()}>
            {children}
        </div>
    );
};

type ExpandableMenuItemGroupProps = {
    children: React.ReactNode;
    className?: string;
    defaultExpanded?: boolean;
};

const ExpandableMenuItemGroup = ({ children, className, defaultExpanded = false }: ExpandableMenuItemGroupProps) => {
    const [isOpen, setIsOpen] = useState(defaultExpanded);

    const toggleOpen = () => {
        setIsOpen(!isOpen);
    };

    const renderChildren = Children.map(children, (child: ReactElement) => {
        if (child.type === ExpandableMenuItemGroupTitle) {
            return cloneElement(child as any, {
                ...child.props,
                onClick: toggleOpen,
            });
        } else {
            return <div className={clsx("expandable-menu-item-group-content", { expanded: isOpen })}>{child}</div>;
        }
    });

    return <div className={clsx("expandable-menu-item-group", className, { open: isOpen })}>{renderChildren}</div>;
};

type ExpandableMenuItemLeftElementProps = {
    children: ReactNode;
    onClick?: () => void;
};

const ExpandableMenuItemLeftElement = ({ children, onClick }: ExpandableMenuItemLeftElementProps) => {
    return (
        <div className="expandable-menu-item-left" onClick={() => onClick?.()}>
            {children}
        </div>
    );
};

type ExpandableMenuItemRightElementProps = {
    children: ReactNode;
    onClick?: () => void;
};

const ExpandableMenuItemRightElement = ({ children, onClick }: ExpandableMenuItemRightElementProps) => {
    return (
        <div className="expandable-menu-item-right" onClick={() => onClick?.()}>
            {children}
        </div>
    );
};

export {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
};
export type { ExpandableMenuItemData };
