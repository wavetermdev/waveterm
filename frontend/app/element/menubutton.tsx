import clsx from "clsx";
import { memo, useState } from "react";
import { Button } from "./button";
import { Menu } from "./menu";

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
                    {text}
                    <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                </Button>
            </Menu>
        </div>
    );
};

export const MenuButton = memo(MenuButtonComponent) as typeof MenuButtonComponent;
