function getLinePos(elem: any): { numLines: number; linePos: number } {
    const numLines = elem.value.split("\n").length;
    const linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
    return { numLines, linePos };
}

function getVisibleLinePos(elem: any): { numLines: number; linePos: number; colPos: number } {
    // Create a temporary div to measure text up to cursor position
    const div = document.createElement("div");
    div.style.whiteSpace = "pre-wrap";
    div.style.visibility = "hidden";
    div.style.position = "absolute";
    div.style.width = elem.clientWidth + "px";
    div.style.font = getComputedStyle(elem).font;
    div.style.lineHeight = getComputedStyle(elem).lineHeight;
    document.body.appendChild(div);

    const cursorPosition = elem.selectionStart;
    div.textContent = elem.value.substring(0, cursorPosition);

    const lineHeight = parseFloat(getComputedStyle(elem).lineHeight);
    const linePos = div.getBoundingClientRect().height / lineHeight;

    // For total lines including wrapping lines
    div.textContent = elem.value;
    const totalHeight = div.getBoundingClientRect().height;
    const numLines = Math.ceil(totalHeight / lineHeight);

    // For column position
    const currentLineStart = elem.value.lastIndexOf("\n", cursorPosition - 1) + 1;
    const colPos = cursorPosition - currentLineStart;

    document.body.removeChild(div);
    return { numLines, linePos: Math.ceil(linePos), colPos: colPos + 1 };
}

function setCursorPosition(elem: HTMLTextAreaElement, index: number) {
    if (elem.setSelectionRange) {
        elem.focus();
        elem.setSelectionRange(index, index);
    } else if ((elem as any).createTextRange) {
        const range = (elem as any).createTextRange();
        range.collapse(true);
        range.moveEnd("character", index);
        range.moveStart("character", index);
        range.select();
    }
}

function getCharIndexFromLineNumber(elem: HTMLTextAreaElement, lineNumber: number): number {
    const div = document.createElement("div");
    div.style.whiteSpace = "pre-wrap";
    div.style.visibility = "hidden";
    div.style.position = "absolute";
    div.style.width = elem.clientWidth + "px";
    div.style.font = getComputedStyle(elem).font;
    div.style.lineHeight = getComputedStyle(elem).lineHeight;
    document.body.appendChild(div);

    const lineHeight = parseFloat(getComputedStyle(elem).lineHeight);
    const targetHeight = lineHeight * lineNumber;
    let charIndex = 0;
    let currentHeight = 0;

    for (charIndex = 0; charIndex < elem.value.length; charIndex++) {
        div.textContent = elem.value.substring(0, charIndex + 1);
        currentHeight = div.getBoundingClientRect().height;
        if (currentHeight >= targetHeight) {
            break;
        }
    }

    document.body.removeChild(div);
    return charIndex;
}

function setCursorToLine(elem: HTMLTextAreaElement, lineNumber: number) {
    const charIndex = getCharIndexFromLineNumber(elem, lineNumber);
    setCursorPosition(elem, charIndex);
}

export { getLinePos, getVisibleLinePos, setCursorPosition, setCursorToLine, getCharIndexFromLineNumber };
