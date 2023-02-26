let MonoFontSizes : {height : number, width : number}[] = [];

MonoFontSizes[8] = {height: 11, width: 4.797};
MonoFontSizes[9] = {height: 12, width: 5.398};
MonoFontSizes[10] = {height: 13, width: 6};
MonoFontSizes[11] = {height: 15, width: 6.602};
MonoFontSizes[12] = {height: 16, width: 7.203};
MonoFontSizes[13] = {height: 18, width: 7.797};
MonoFontSizes[14] = {height: 19, width: 8.398};
MonoFontSizes[15] = {height: 20, width: 9};

function getMonoFontSize(fontSize : number) : {height : number, width : number} {
    return MonoFontSizes[fontSize];
}

function measureText(text : string, textOpts? : {pre? : boolean, mono? : boolean, fontSize? : number|string}) : DOMRect {
    if (textOpts == null) {
        textOpts = {};
    }
    let textElem = document.createElement("div");
    if (textOpts.pre) {
        textElem.classList.add("pre");
    }
    if (textOpts.mono) {
        textElem.classList.add("mono");
    }
    if (textOpts.fontSize != null) {
        if (typeof(textOpts.fontSize) == "number") {
            textElem.style.fontSize = textOpts.fontSize + "px";
        }
        else {
            textElem.style.fontSize = textOpts.fontSize;
        }
    }
    textElem.innerText = text;
    let measureDiv = document.getElementById("measure");
    if (measureDiv == null) {
        throw new Error("cannot measure text, no #measure div");
    }
    measureDiv.replaceChildren(textElem);
    return measureDiv.getBoundingClientRect()
}

export {measureText, getMonoFontSize};
