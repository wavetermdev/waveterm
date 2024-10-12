import clsx from "clsx";
import { memo } from "react";
import { Button } from "./button";
import { Menu } from "./menu";

const MenuButtonComponent = ({ items, className, text }: { items: MenuItem[]; className: string; text: string }) => {
    return (
        <div className={clsx("menubutton", className)}>
            <Menu items={items}>
                <Button className="grey border-radius-3 vertical-padding-2 horizontal-padding-2">
                    {text}
                    <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                </Button>
            </Menu>
        </div>
    );
};

export const MenuButton = memo(MenuButtonComponent) as typeof MenuButtonComponent;
