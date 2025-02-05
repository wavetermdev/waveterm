import { globalStore } from "@/app/store/jotaiStore";
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/shadcn/command";
import { atom, useAtom } from "jotai";
import React, { useState } from "react";

class QuickLaunchModel {
    private static instance: QuickLaunchModel;

    private constructor() {}

    public static getInstance(): QuickLaunchModel {
        if (!QuickLaunchModel.instance) {
            QuickLaunchModel.instance = new QuickLaunchModel();
        }
        return QuickLaunchModel.instance;
    }

    public openAtom = atom<boolean>(false);

    public toggleOpenState() {
        const currentState = globalStore.get(this.openAtom);
        globalStore.set(this.openAtom, !currentState);
    }
}

export const quickLaunchModel = QuickLaunchModel.getInstance();

// Type definitions
type CommandType = "url" | "directory" | "shell" | "command";

interface CommandMatch {
    id: string;
    type: CommandType;
    title: string;
    subtitle?: string;
    url?: string;
    directory?: string;
    command?: string;
    connection?: string;
    color?: string;
    icon?: string; // FontAwesome class string
    iconImage?: string; // base64 encoded image
}

interface SearchResponse {
    matches: CommandMatch[];
}

// Mock data
const MOCK_COMMANDS: CommandMatch[] = [
    {
        id: "1",
        type: "url",
        title: "Wave GitHub",
        subtitle: "github.com/wave-framework/wave",
        url: "https://github.com/wave-framework/wave",
        icon: "fa-sharp fa-github",
    },
    {
        id: "2",
        type: "url",
        title: "Wave Documentation",
        subtitle: "docs.wave-framework.io",
        url: "https://docs.wave-framework.io",
        icon: "fa-sharp fa-book",
    },
    {
        id: "3",
        type: "directory",
        title: "~/projects/wave",
        subtitle: "Local Wave repository",
        directory: "~/projects/wave",
    },
    {
        id: "4",
        type: "shell",
        title: "Production Server",
        subtitle: "ssh wave@prod-1",
        command: "ssh wave@prod-1",
        icon: "fa-sharp fa-server",
        color: "#00ff00",
    },
    {
        id: "5",
        type: "command",
        title: "System Monitor",
        subtitle: "Run htop",
        command: "htop",
        icon: "fa-sharp fa-chart-line",
    },
    {
        id: "6",
        type: "url",
        title: "Wave Discord",
        subtitle: "discord.gg/wave-community",
        url: "https://discord.gg/wave-community",
        icon: "fa-sharp fa-discord",
        color: "#5865F2",
    },
];

interface SearchResponse {
    matches: CommandMatch[];
}

const searchCommands = async (search: string): Promise<SearchResponse> => {
    if (!search) {
        return { matches: MOCK_COMMANDS };
    }

    const searchLower = search.toLowerCase();
    const filtered = MOCK_COMMANDS.filter((cmd) => {
        return (
            cmd.title.toLowerCase().includes(searchLower) ||
            cmd.subtitle?.toLowerCase().includes(searchLower) ||
            cmd.url?.toLowerCase().includes(searchLower) ||
            cmd.directory?.toLowerCase().includes(searchLower) ||
            cmd.command?.toLowerCase().includes(searchLower)
        );
    });

    return { matches: filtered };
};

const QuickLaunchPalette = () => {
    const [results, setResults] = useState<SearchResponse>({ matches: MOCK_COMMANDS });
    const [open, setOpen] = useAtom(quickLaunchModel.openAtom);

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen(true);
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    const handleSearch = async (value: string) => {
        const response = await searchCommands(value);
        setResults(response);
    };

    const getDefaultIcon = (type: CommandType) => {
        switch (type) {
            case "url":
                return "fa-globe";
            case "directory":
                return "fa-folder";
            case "shell":
                return "fa-terminal";
            case "command":
                return "fa-play";
        }
    };

    const renderIcon = (item: CommandMatch) => {
        if (item.iconImage) {
            return <img src={item.iconImage} alt="" className="h-4 w-4 object-contain" />;
        }

        const iconClass = item.icon || getDefaultIcon(item.type);
        const style = item.color ? { color: item.color } : undefined;

        return <i className={`fa ${iconClass}`} style={style} />;
    };

    const handleSelect = (item: CommandMatch) => {
        // Handle the selection based on type
        switch (item.type) {
            case "url":
                // Open URL in web browser widget
                break;
            case "directory":
                // Open directory in file viewer
                break;
            case "shell":
                // Open shell in specified directory
                break;
            case "command":
                // Execute command
                break;
        }
        setOpen(false);
    };

    return (
        <CommandDialog open={open} onOpenChange={setOpen} variant="quicklaunch">
            <Command className="rounded-lg" shouldFilter={false}>
                <CommandInput placeholder="Type a command or search..." onValueChange={handleSearch} />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    {results.matches.length > 0 && (
                        <CommandGroup>
                            {results.matches.map((item) => (
                                <CommandItem
                                    key={item.id}
                                    onSelect={() => handleSelect(item)}
                                    className="flex items-center space-x-2"
                                >
                                    <div className="flex items-center space-x-2 flex-1">
                                        <div className="flex-shrink-0 w-6">{renderIcon(item)}</div>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{item.title}</span>
                                            {item.subtitle && (
                                                <span className="text-sm text-gray-500">{item.subtitle}</span>
                                            )}
                                        </div>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                </CommandList>
            </Command>
        </CommandDialog>
    );
};

export default QuickLaunchPalette;
