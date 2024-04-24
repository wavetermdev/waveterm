import { Model } from "./model";
import * as mobx from "mobx";
import { Shell, getSuggestions } from "@/autocomplete";
import log from "@/autocomplete/utils/log";

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
    suggestions: OV<Fig.Suggestion[]> = mobx.observable.box(null);
    primarySuggestionIndex: OV<number> = mobx.observable.box(0);
    charsToDrop: number = 0;
    @mobx.observable historyLoaded: boolean = false;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;

        // This is a hack to get the suggestions to update after the history is loaded the first time
        mobx.reaction(
            () => this.globalModel.inputModel.historyItems.get() != null,
            () => {
                log.debug("history loaded, reloading suggestions");
                this.loadSuggestions();
            }
        );
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
        if (!this.isEnabled()) {
            this.suggestions.set(null);
            return;
        }
        log.debug("get suggestions");
        try {
            const festate = this.globalModel.getCurRemoteInstance().festate;
            const suggestions: Fig.Suggestion[] = yield getSuggestions(
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
    getSuggestions(): Fig.Suggestion[] {
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
        const autocompleteSuggestions: Fig.Suggestion[] = this.getSuggestions();

        // Build the ghost prompt with the primary suggestion if available
        let retVal = "";
        if (autocompleteSuggestions != null && autocompleteSuggestions.length > index) {
            const suggestion = autocompleteSuggestions[index];
            if (typeof suggestion.name === "string") {
                retVal = suggestion.name;
            } else if (suggestion.name.length > 0) {
                retVal = suggestion.name[0];
            }
            if (suggestion.insertValue) {
                retVal = suggestion.insertValue;
            }

            // The following is a workaround for slow responses from underlying commands. It assumes that the primary suggestion will be a continuation of the current token.
            // The runtime will provide a number of chars to drop, but it will return after the render has already completed, meaning we will end up with a flicker. This is a workaround to prevent the flicker.
            // As we add more characters to the current token, we assume we need to drop the same number of characters from the primary suggestion, even if the runtime has not yet provided the updated characters to drop.
            const curLine = this.globalModel.inputModel.curLine;
            const curEndTokenLen = getEndTokenLength(curLine);
            const lastEndTokenLen = getEndTokenLength(this.globalModel.inputModel.lastCurLine);
            if (curEndTokenLen > lastEndTokenLen) {
                this.charsToDrop = Math.max(curEndTokenLen, this.charsToDrop ?? 0);
            } else {
                this.charsToDrop = Math.min(curEndTokenLen, this.charsToDrop ?? 0);
            }

            if (this.charsToDrop > 0) {
                retVal = retVal.substring(this.charsToDrop);
            }
            log.debug("ghost prompt", curLine + retVal);
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
        let suggestionCompletion = this.getSuggestionCompletion(index);
        if (suggestionCompletion) {
            let pos: number;
            const curLine = this.globalModel.inputModel.curLine;
            if (suggestionCompletion.includes("{cursor}")) {
                pos = curLine.length + suggestionCompletion.indexOf("{cursor}");
                suggestionCompletion = suggestionCompletion.replace("{cursor}", "");
            }
            const newLine = curLine + suggestionCompletion;
            pos = pos ?? newLine.length;
            this.globalModel.inputModel.updateCmdLine({ str: newLine, pos: pos });
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
