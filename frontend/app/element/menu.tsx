// Menu.tsx
import { clsx } from "clsx";
import { Children, ReactElement, ReactNode, cloneElement, useState } from "react";

import "./menu.less";

type BaseMenuItem = {
    id: string;
    type: "item" | "group";
};

interface MenuItemType extends BaseMenuItem {
    type: "item";
    leftElement?: string | ReactNode;
    rightElement?: string | ReactNode;
    content?: React.ReactNode;
}

interface MenuItemGroupTitleType {
    leftElement?: string | ReactNode;
    label: string;
    rightElement?: string | ReactNode;
}

interface MenuItemGroupType extends BaseMenuItem {
    type: "group";
    title: MenuItemGroupTitleType;
    defaultExpanded?: boolean;
    children?: MenuItemData[];
}

type MenuItemData = MenuItemType | MenuItemGroupType;

type MenuProps = {
    children: React.ReactNode;
    className?: string;
};

const Menu = ({ children, className }: MenuProps) => {
    return <div className={clsx("menu", className)}>{children}</div>;
};

type MenuItemProps = {
    children: ReactNode;
    className?: string;
    withHoverEffect?: boolean;
    onClick?: () => void;
};

const MenuItem = ({ children, className, withHoverEffect = true, onClick }: MenuItemProps) => {
    return (
        <div
            className={clsx("menu-item", className, { "with-hover-effect": withHoverEffect === true })}
            onClick={onClick}
        >
            {children}
        </div>
    );
};

type MenuItemGroupTitleProps = {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
};

const MenuItemGroupTitle = ({ children, className, onClick }: MenuItemGroupTitleProps) => {
    return (
        <div className={clsx("menu-item-group-title", className)} onClick={() => onClick?.()}>
            {children}
        </div>
    );
};

type MenuItemGroupProps = {
    children: React.ReactNode;
    className?: string;
    defaultExpanded?: boolean;
};

const MenuItemGroup = ({ children, className, defaultExpanded = false }: MenuItemGroupProps) => {
    const [isOpen, setIsOpen] = useState(defaultExpanded);

    const toggleOpen = () => {
        setIsOpen(!isOpen);
    };

    const renderChildren = Children.map(children, (child: ReactElement) => {
        if (child.type === MenuItemGroupTitle) {
            return cloneElement(child as any, {
                ...child.props,
                onClick: toggleOpen,
            });
        } else {
            return <div className={clsx("menu-item-group-content", { expanded: isOpen })}>{child}</div>;
        }
    });

    return <div className={clsx("menu-item-group", className, { open: isOpen })}>{renderChildren}</div>;
};

type MenuItemLeftElementProps = {
    children: ReactNode;
    onClick?: () => void;
};

const MenuItemLeftElement = ({ children, onClick }: MenuItemLeftElementProps) => {
    return (
        <div className="menu-item-left" onClick={() => onClick?.()}>
            {children}
        </div>
    );
};

type MenuItemRightElementProps = {
    children: ReactNode;
    onClick?: () => void;
};

const MenuItemRightElement = ({ children, onClick }: MenuItemRightElementProps) => {
    return (
        <div className="menu-item-right" onClick={() => onClick?.()}>
            {children}
        </div>
    );
};

export { Menu, MenuItem, MenuItemGroup, MenuItemGroupTitle, MenuItemLeftElement, MenuItemRightElement };
export type { MenuItemData };
