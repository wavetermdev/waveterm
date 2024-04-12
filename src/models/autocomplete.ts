import { SuggestionBlob } from "@/autocomplete/runtime/model";
import { Model } from "./model";
import * as mobx from "mobx";
import { Shell, getSuggestions } from "@/autocomplete";

/**
 * Gets the length of the token at the end of the line.
 * @param line the line
 * @returns the length of the token at the end of the line
 */
function getEndTokenLength(line: string): number {
    const lastSpaceIndex = line?.lastIndexOf(" ");
    return line ? line.length - lastSpaceIndex - 1 : 0;
}

/**
 * The autocomplete model.
 */
export class AutocompleteModel {
    globalModel: Model;
    suggestions: OV<SuggestionBlob> = mobx.observable.box(null);
    primarySuggestionIndex: OV<number> = mobx.observable.box(0);

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    /**
     * Returns whether the autocomplete feature is enabled.
     * @returns whether the autocomplete feature is enabled
     */
    isEnabled(): boolean {
        const clientData: ClientDataType = this.globalModel.clientData.get();
        return clientData?.clientopts.autocompleteenabled ?? false;
    }

    /**
     * Lazily loads suggestions for the current input line.
     */
    loadSuggestions = mobx.flow(function* (this: AutocompleteModel) {
        console.log("get suggestions");
        if (!this.isEnabled()) {
            this.suggestions.set(null);
            return;
        }
        try {
            const festate = this.globalModel.getCurRemoteInstance().festate;
            const suggestions: SuggestionBlob = yield getSuggestions(
                this.globalModel.inputModel.curLine,
                festate.cwd,
                festate.shell as Shell
            );
            this.suggestions.set(suggestions);
        } catch (error) {
            console.error("error getting suggestions: ", error);
        }
    });

    /**
     * Returns the current suggestions.
     * @returns the current suggestions
     */
    getSuggestions(): SuggestionBlob {
        if (!this.isEnabled()) {
            return null;
        }
        return this.suggestions.get();
    }

    /**
     * Clears the current suggestions.
     */
    clearSuggestions(): void {
        if (!this.isEnabled()) {
            return;
        }
        mobx.action(() => {
            this.suggestions.set(null);
            this.primarySuggestionIndex.set(0);
        })();
    }

    /**
     * Returns the index of the primary suggestion.
     * @returns the index of the primary suggestion
     */
    getPrimarySuggestionIndex(): number {
        return this.primarySuggestionIndex.get();
    }

    /**
     * Sets the index of the primary suggestion.
     * @param index the index of the primary suggestion
     */
    setPrimarySuggestionIndex(index: number): void {
        if (!this.isEnabled()) {
            return;
        }
        mobx.action(() => {
            this.primarySuggestionIndex.set(index);
        })();
    }

    /**
     * Returns the additional text required to add to the current input line in order to apply the suggestion at the given index.
     * @param index the index of the suggestion to apply
     * @returns the additional text required to add to the current input line in order to apply the suggestion at the given index
     */
    getSuggestionCompletion(index: number): string {
        const autocompleteSuggestions: SuggestionBlob = this.getSuggestions();

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

    /**
     * Returns the additional text required to add to the current input line in order to apply the primary suggestion.
     * @returns the additional text required to add to the current input line in order to apply the primary suggestion
     * @see getSuggestionCompletion
     * @see getPrimarySuggestionIndex
     */
    getPrimarySuggestionCompletion(): string {
        if (!this.isEnabled()) {
            return null;
        }
        return this.getSuggestionCompletion(this.getPrimarySuggestionIndex());
    }

    /**
     * Applies the suggestion at the given index to the current input line.
     * @param index the index of the suggestion to apply
     */
    applySuggestion(index: number): void {
        if (!this.isEnabled()) {
            return;
        }
        const suggestionCompletion = this.getSuggestionCompletion(index);
        if (suggestionCompletion) {
            this.globalModel.inputModel.setCurLine(this.globalModel.inputModel.curLine + suggestionCompletion);
        }
    }

    /**
     * Applies the primary suggestion to the current input line.
     * @see applySuggestion
     * @see getPrimarySuggestionIndex
     */
    applyPrimarySuggestion(): void {
        this.applySuggestion(this.getPrimarySuggestionIndex());
    }
}
