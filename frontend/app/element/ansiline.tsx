export const ANSI_TAILWIND_MAP = {
    // Reset and modifiers
    0: "reset", // special: clear state
    1: "font-bold",
    2: "opacity-75",
    3: "italic",
    4: "underline",
    8: "invisible",
    9: "line-through",

    // Foreground standard colors
    30: "text-ansi-black",
    31: "text-ansi-red",
    32: "text-ansi-green",
    33: "text-ansi-yellow",
    34: "text-ansi-blue",
    35: "text-ansi-magenta",
    36: "text-ansi-cyan",
    37: "text-ansi-white",

    // Foreground bright colors
    90: "text-ansi-brightblack",
    91: "text-ansi-brightred",
    92: "text-ansi-brightgreen",
    93: "text-ansi-brightyellow",
    94: "text-ansi-brightblue",
    95: "text-ansi-brightmagenta",
    96: "text-ansi-brightcyan",
    97: "text-ansi-brightwhite",

    // Background standard colors
    40: "bg-ansi-black",
    41: "bg-ansi-red",
    42: "bg-ansi-green",
    43: "bg-ansi-yellow",
    44: "bg-ansi-blue",
    45: "bg-ansi-magenta",
    46: "bg-ansi-cyan",
    47: "bg-ansi-white",

    // Background bright colors
    100: "bg-ansi-brightblack",
    101: "bg-ansi-brightred",
    102: "bg-ansi-brightgreen",
    103: "bg-ansi-brightyellow",
    104: "bg-ansi-brightblue",
    105: "bg-ansi-brightmagenta",
    106: "bg-ansi-brightcyan",
    107: "bg-ansi-brightwhite",
};

type InternalStateType = {
    modifiers: Set<string>;
    textColor: string | null;
    bgColor: string | null;
    reverse: boolean;
};

type SegmentType = {
    text: string;
    classes: string;
};

const makeInitialState: () => InternalStateType = () => ({
    modifiers: new Set<string>(),
    textColor: null,
    bgColor: null,
    reverse: false,
});

const updateStateWithCodes = (state, codes) => {
    codes.forEach((code) => {
        if (code === 0) {
            // Reset state
            state.modifiers.clear();
            state.textColor = null;
            state.bgColor = null;
            state.reverse = false;
            return;
        }
        // Instead of swapping immediately, we set a flag
        if (code === 7) {
            state.reverse = true;
            return;
        }
        const tailwindClass = ANSI_TAILWIND_MAP[code];
        if (tailwindClass && tailwindClass !== "reset") {
            if (tailwindClass.startsWith("text-")) {
                state.textColor = tailwindClass;
            } else if (tailwindClass.startsWith("bg-")) {
                state.bgColor = tailwindClass;
            } else {
                state.modifiers.add(tailwindClass);
            }
        }
    });
    return state;
};

const stateToClasses = (state: InternalStateType) => {
    const classes = [];
    classes.push(...Array.from(state.modifiers));

    // Apply reverse: swap text and background colors if flag is set.
    let textColor = state.textColor;
    let bgColor = state.bgColor;
    if (state.reverse) {
        [textColor, bgColor] = [bgColor, textColor];
    }
    if (textColor) classes.push(textColor);
    if (bgColor) classes.push(bgColor);

    return classes.join(" ");
};

const ansiRegex = /\x1b\[([0-9;]+)m/g;

const AnsiLine = ({ line }) => {
    const segments: SegmentType[] = [];
    let lastIndex = 0;
    let currentState = makeInitialState();

    let match: RegExpExecArray;
    while ((match = ansiRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
            segments.push({
                text: line.substring(lastIndex, match.index),
                classes: stateToClasses(currentState),
            });
        }
        const codes = match[1].split(";").map(Number);
        updateStateWithCodes(currentState, codes);
        lastIndex = ansiRegex.lastIndex;
    }

    if (lastIndex < line.length) {
        segments.push({
            text: line.substring(lastIndex),
            classes: stateToClasses(currentState),
        });
    }

    return (
        <div>
            {segments.map((seg, idx) => (
                <span key={idx} className={seg.classes}>
                    {seg.text}
                </span>
            ))}
        </div>
    );
};

export default AnsiLine;
