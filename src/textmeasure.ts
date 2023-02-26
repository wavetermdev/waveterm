let canvasElem = document.createElement("canvas");

function measureText(text : string, textOpts? : {pre? : boolean, mono? : boolean, fontSize? : number|string}) : {width : number, height : number} {
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
    return {width: textElem.clientWidth, height: textElem.clientHeight};
}

export {measureText};
