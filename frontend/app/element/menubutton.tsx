import clsx from "clsx";
import { memo, useState } from "react";
import { Button } from "./button";
import { Menu } from "./menu";
import "./menubutton.less";

const MenuButtonComponent = ({ items, className, text, title }: MenuButtonProps) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className={clsx("menubutton", className)}>
            <Menu items={items} onOpenChange={setIsOpen}>
                <Button
                    className="grey border-radius-3 vertical-padding-2 horizontal-padding-2"
                    style={{ borderColor: isOpen ? "var(--accent-color)" : "transparent" }}
                    title={title}
                >
                    <div>{text}</div>
                    <i className="fa-sharp fa-solid fa-angle-down"></i>
                </Button>
            </Menu>
        </div>
    );
};

export const MenuButton = memo(MenuButtonComponent) as typeof MenuButtonComponent;
