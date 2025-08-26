// Copyright 2025, Command Line
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import { atom, useAtom } from "jotai";
import { Children, ReactElement, ReactNode, cloneElement, isValidElement, useRef } from "react";

import "./expandablemenu.scss";

// Define the global atom for managing open groups
const openGroupsAtom = atom<{ [key: string]: boolean }>({});

type BaseExpandableMenuItem = {
    type: "item" | "group";
    id?: string;
};

interface ExpandableMenuItemType extends BaseExpandableMenuItem {
    type: "item";
    leftElement?: string | ReactNode;
    rightElement?: string | ReactNode;
    content?: React.ReactNode | ((props: any) => React.ReactNode);
}

interface ExpandableMenuItemGroupTitleType {
    leftElement?: string | ReactNode;
    label: string;
    rightElement?: string | ReactNode;
}

interface ExpandableMenuItemGroupType extends BaseExpandableMenuItem {
    type: "group";
    title: ExpandableMenuItemGroupTitleType;
    isOpen?: boolean;
    children?: ExpandableMenuItemData[];
}

type ExpandableMenuItemData = ExpandableMenuItemType | ExpandableMenuItemGroupType;

type ExpandableMenuProps = {
    children: React.ReactNode;
    className?: string;
    noIndent?: boolean;
    singleOpen?: boolean;
};

const ExpandableMenu = ({ children, className, noIndent = false, singleOpen = false }: ExpandableMenuProps) => {
    return (
        <div className={clsx("expandable-menu", className, { "no-indent": noIndent })}>
            {Children.map(children, (child) => {
                if (isValidElement(child) && child.type === ExpandableMenuItemGroup) {
                    return cloneElement(child as any, { singleOpen });
                }
                return child;
            })}
        </div>
    );
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
                "with-hover-effect": withHoverEffect,
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
        <div className={clsx("expandable-menu-item-group-title", className)} onClick={onClick}>
            {children}
        </div>
    );
};

type ExpandableMenuItemGroupProps = {
    children: React.ReactNode;
    className?: string;
    isOpen?: boolean;
    onToggle?: (isOpen: boolean) => void;
    singleOpen?: boolean;
};

const ExpandableMenuItemGroup = ({
    children,
    className,
    isOpen,
    onToggle,
    singleOpen = false,
}: ExpandableMenuItemGroupProps) => {
    const [openGroups, setOpenGroups] = useAtom(openGroupsAtom);

    // Generate a unique ID for this group using useRef
    const idRef = useRef<string>(null);

    if (!idRef.current) {
        // Generate a unique ID when the component is first rendered
        idRef.current = `group-${Math.random().toString(36).substr(2, 9)}`;
    }

    const id = idRef.current;

    // Determine if the component is controlled or uncontrolled
    const isControlled = isOpen !== undefined;

    // Get the open state from global atom in uncontrolled mode
    const actualIsOpen = isControlled ? isOpen : (openGroups[id] ?? false);

    const toggleOpen = () => {
        const newIsOpen = !actualIsOpen;

        if (isControlled) {
            // If controlled, call the onToggle callback
            onToggle?.(newIsOpen);
        } else {
            // If uncontrolled, update global atom
            setOpenGroups((prevOpenGroups) => {
                if (singleOpen) {
                    // Close all other groups and open this one
                    return { [id]: newIsOpen };
                } else {
                    // Toggle this group
                    return { ...prevOpenGroups, [id]: newIsOpen };
                }
            });
        }
    };

    const renderChildren = Children.map(children, (child: ReactElement) => {
        if (child && child.type === ExpandableMenuItemGroupTitle) {
            const childProps = child.props as ExpandableMenuItemGroupTitleProps;
            return cloneElement(child as ReactElement<ExpandableMenuItemGroupTitleProps>, {
                ...childProps,
                onClick: () => {
                    childProps.onClick?.();
                    toggleOpen();
                },
            });
        } else {
            return <div className={clsx("expandable-menu-item-group-content", { open: actualIsOpen })}>{child}</div>;
        }
    });

    return (
        <div className={clsx("expandable-menu-item-group", className, { open: actualIsOpen })}>{renderChildren}</div>
    );
};

type ExpandableMenuItemLeftElementProps = {
    children: ReactNode;
    onClick?: () => void;
};

const ExpandableMenuItemLeftElement = ({ children, onClick }: ExpandableMenuItemLeftElementProps) => {
    return (
        <div className="expandable-menu-item-left" onClick={onClick}>
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
        <div className="expandable-menu-item-right" onClick={onClick}>
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
export type { ExpandableMenuItemData, ExpandableMenuItemGroupTitleType };
