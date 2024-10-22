// Menu.tsx
import { clsx } from "clsx";
import { ReactNode, useState } from "react";
import "./menu.less";

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
    onClick?: () => void;
};

const MenuItem = ({ children, className, onClick }: MenuItemProps) => {
    return (
        <div className={clsx("menu-item", className)} onClick={onClick}>
            {children}
        </div>
    );
};

type MenuItemGroupProps = {
    title: ReactNode;
    children: React.ReactNode;
    className?: string;
    defaultExpanded?: boolean;
};

const MenuItemGroup = ({ title, children, className, defaultExpanded = false }: MenuItemGroupProps) => {
    const [isOpen, setIsOpen] = useState(defaultExpanded);

    const toggleOpen = () => {
        setIsOpen(!isOpen);
    };

    return (
        <div className={clsx("menu-item-group", className, { open: isOpen })}>
            <div className="menu-item-group-title" onClick={toggleOpen}>
                {title}
            </div>
            <div className={clsx("menu-item-group-content", { expanded: isOpen })}>{children}</div>
        </div>
    );
};

type MenuItemLeftElementProps = {
    children: ReactNode;
};

const MenuItemLeftElement = ({ children }: MenuItemLeftElementProps) => {
    return <div className="menu-item-left">{children}</div>;
};

type MenuItemRightElementProps = {
    children: ReactNode;
};

const MenuItemRightElement = ({ children }: MenuItemRightElementProps) => {
    return <div className="menu-item-right">{children}</div>;
};

export { Menu, MenuItem, MenuItemGroup, MenuItemLeftElement, MenuItemRightElement };
