// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import ThunderSVG from "../asset/thunder.svg";
import WorskpaceSVG from "../asset/workspace.svg";

import "./workspaceswitcher.less";

interface ColorSelectorType {
    name: string;
    color: string;
}

const ColorSelector: ColorSelectorType[] = [];

// const dummyData: ExpandableMenuItemData[] = [
// 	{
// 		type: "group",
// 		title: {
// 			leftElement: <i class="fa-sharp fa-solid fa-heart"></i>,
// 			label: ""
// 		},
// 		children: {
// 			{
// 				type: "item",
// 				content
// 			}
// 		}
// 	}
// ]

const WorkspaceSwitcher = () => {
    return (
        <Popover className="workspace-switcher-popover">
            <PopoverButton className="workspace-switcher-button grey" as="div">
                <span className="icon-left">
                    <WorskpaceSVG></WorskpaceSVG>
                </span>
                <span className="divider" />
                <span className="icon-right">
                    <ThunderSVG></ThunderSVG>
                </span>
            </PopoverButton>
            <PopoverContent>
                <div className="header">Switch workspace</div>
                {/* <ExpandableMenu></ExpandableMenu> */}
            </PopoverContent>
        </Popover>
    );
};

export { WorkspaceSwitcher };
