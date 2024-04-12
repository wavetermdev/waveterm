import { SuggestionBlob } from "@/autocomplete/runtime/model";
import { Model } from "./model";
import * as mobx from "mobx";
import { Shell, getSuggestions } from "@/autocomplete";

function getEndTokenLength(line: string): number {
    const lastSpaceIndex = line?.lastIndexOf(" ");
    return line ? line.length - lastSpaceIndex - 1 : 0;
}

export class AutocompleteModel {
    globalModel: Model;
    autocompleteSuggestions: OV<SuggestionBlob> = mobx.observable.box(null);
    primarySuggestionIndex: OV<number> = mobx.observable.box(0);

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    isEnabled(): boolean {
        const clientData: ClientDataType = this.globalModel.clientData.get();
        return clientData?.clientopts.autocompleteenabled;
    }

    loadAutocompleteSuggestions = mobx.flow(function* (this: AutocompleteModel) {
        console.log("get suggestions");
        if (!this.isEnabled()) {
            this.autocompleteSuggestions.set(null);
            return;
        }
        try {
            const festate = this.globalModel.getCurRemoteInstance().festate;
            const suggestions: SuggestionBlob = yield getSuggestions(
                this.globalModel.inputModel.curLine,
                festate.cwd,
                festate.shell as Shell
            );
            this.autocompleteSuggestions.set(suggestions);
        } catch (error) {
            console.error("error getting suggestions: ", error);
        }
    });

    getAutocompleteSuggestions(): SuggestionBlob {
        if (!this.isEnabled()) {
            return null;
        }
        return this.autocompleteSuggestions.get();
    }

    setAutocompleteSuggestions(suggestions: SuggestionBlob): void {
        if (!this.isEnabled()) {
            return;
        }
        mobx.action(() => {
            this.autocompleteSuggestions.set(suggestions);
            this.primarySuggestionIndex.set(0);
        })();
    }

    getPrimarySuggestion(): string {
        const suggestions = this.getAutocompleteSuggestions();
        if (!suggestions) {
            return null;
        }
        return suggestions.suggestions[this.getPrimarySuggestionIndex()].name;
    }

    getPrimarySuggestionIndex(): number {
        if (!this.isEnabled()) {
            return null;
        }
        return this.primarySuggestionIndex.get();
    }

    setPrimarySuggestionIndex(index: number): void {
        if (!this.isEnabled()) {
            return;
        }
        mobx.action(() => {
            this.primarySuggestionIndex.set(index);
        })();
    }

    getSuggestionCompletion(index: number): string {
        const autocompleteSuggestions: SuggestionBlob = this.getAutocompleteSuggestions();

        // Build the ghost prompt with the primary suggestion if available
        let retVal = "";
        if (autocompleteSuggestions != null && autocompleteSuggestions.suggestions.length > index) {
            retVal = autocompleteSuggestions.suggestions[index].name;

            // The following is a workaround for slow responses from underlying commands. It assumes that the primary suggestion will be a continuation of the current token.
            // The runtime will provide a number of chars to drop, but it will return after the render has already completed, meaning we will end up with a flicker. This is a workaround to prevent the flicker.
            // As we add more characters to the current token, we assume we need to drop the same number of characters from the primary suggestion, even if the runtime has not yet provided the updated characters to drop.
            const curLine = this.globalModel.inputModel.curLine;
            const curEndTokenLen = getEndTokenLength(curLine);
            const lastEndTokenLen = getEndTokenLength(this.globalModel.inputModel.lastCurLine);
            let charactersToDrop = 0;
            if (curEndTokenLen > lastEndTokenLen) {
                charactersToDrop = Math.max(curEndTokenLen, autocompleteSuggestions?.charactersToDrop ?? 0);
            } else {
                charactersToDrop = Math.min(curEndTokenLen, autocompleteSuggestions?.charactersToDrop ?? 0);
            }

            if (charactersToDrop > 0) {
                retVal = retVal.substring(charactersToDrop);
            }
            console.log("ghost prompt", curLine + retVal);
        }
        return retVal;
    }

    getPrimarySuggestionCompletion(): string {
        if (!this.isEnabled()) {
            return null;
        }
        return this.getSuggestionCompletion(this.getPrimarySuggestionIndex());
    }
}
