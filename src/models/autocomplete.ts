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
    if (!line) {
        return 0;
    }
    const lastSpaceIndex = line.lastIndexOf(" ");
    if (lastSpaceIndex < line.length) {
        return line.length - line.lastIndexOf(" ") - 1;
    }
    return line.length;
}

/**
 * The autocomplete model.
 */
export class AutocompleteModel {
    globalModel: Model;
    @mobx.observable suggestions: Fig.Suggestion[] = null;
    @mobx.observable primarySuggestionIndex: number = 0;
    charsToDrop: number = 0;
    @mobx.observable historyLoaded: boolean = false;
    @mobx.observable loggingEnabled: boolean;

    constructor(globalModel: Model) {
        mobx.makeObservable(this);
        this.globalModel = globalModel;

        this.loggingEnabled = globalModel.isDev;

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
            this.suggestions = null;
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
            this.suggestions = suggestions;
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

        return this.suggestions;
    }

    /**
     * Clears the current suggestions.
     */
    clearSuggestions(): void {
        if (!this.isEnabled()) {
            return;
        }
        mobx.action(() => {
            this.suggestions = null;
            this.primarySuggestionIndex = 0;
        })();
    }

    /**
     * Returns the index of the primary suggestion.
     * @returns the index of the primary suggestion
     */
    getPrimarySuggestionIndex(): number {
        return this.primarySuggestionIndex;
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
            this.primarySuggestionIndex = index;
        })();
    }

    /**
     * Returns the additional text required to add to the current input line in order to apply the suggestion at the given index.
     * @param index the index of the suggestion to apply
     * @returns the additional text required to add to the current input line in order to apply the suggestion at the given index
     */
    getSuggestionCompletion(index: number): string {
        log.debug("getSuggestionCompletion", index);
        const autocompleteSuggestions: Fig.Suggestion[] = this.getSuggestions();

        // Build the ghost prompt with the primary suggestion if available
        let retVal = "";
        log.debug("autocompleteSuggestions", autocompleteSuggestions);
        if (autocompleteSuggestions != null && autocompleteSuggestions.length > index) {
            const suggestion = autocompleteSuggestions[index];
            log.debug("suggestion", suggestion);

            if (!suggestion) {
                return null;
            }

            if (suggestion.insertValue) {
                retVal = suggestion.insertValue;
            } else if (typeof suggestion.name === "string") {
                retVal = suggestion.name;
            } else if (suggestion.name.length > 0) {
                retVal = suggestion.name[0];
            }
            const curLine = this.globalModel.inputModel.curLine;

            if (retVal.startsWith(curLine.trim())) {
                // This accounts for if the first suggestion is a history item, since this will be the full command string.
                retVal = retVal.substring(curLine.length);
            } else {
                log.debug("retVal", retVal);

                // The following is a workaround for slow responses from underlying commands. It assumes that the primary suggestion will be a continuation of the current token.
                // The runtime will provide a number of chars to drop, but it will return after the render has already completed, meaning we will end up with a flicker. This is a workaround to prevent the flicker.
                // As we add more characters to the current token, we assume we need to drop the same number of characters from the primary suggestion, even if the runtime has not yet provided the updated characters to drop.
                const curEndTokenLen = getEndTokenLength(curLine);
                const lastEndTokenLen = getEndTokenLength(this.globalModel.inputModel.lastCurLine);
                log.debug("curEndTokenLen", curEndTokenLen, "lastEndTokenLen", lastEndTokenLen);
                if (curEndTokenLen > lastEndTokenLen) {
                    this.charsToDrop = Math.max(curEndTokenLen, this.charsToDrop ?? 0);
                } else {
                    this.charsToDrop = Math.min(curEndTokenLen, this.charsToDrop ?? 0);
                }

                if (this.charsToDrop > 0) {
                    retVal = retVal.substring(this.charsToDrop);
                }
                log.debug("charsToDrop", this.charsToDrop, "retVal", retVal);
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
        const suggestionIndex = this.getPrimarySuggestionIndex();
        const retVal = this.getSuggestionCompletion(suggestionIndex);
        if (retVal) {
            return retVal;
        } else if (suggestionIndex > 0) {
            this.setPrimarySuggestionIndex(0);
        }
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
        log.debug("applying suggestion: ", suggestionCompletion);
        if (suggestionCompletion) {
            let pos: number;
            const curLine = this.globalModel.inputModel.curLine;
            if (suggestionCompletion.includes("{cursor}")) {
                pos = curLine.length + suggestionCompletion.indexOf("{cursor}");
                suggestionCompletion = suggestionCompletion.replace("{cursor}", "");
            }
            const newLine = curLine + suggestionCompletion;
            pos = pos ?? newLine.length;
            log.debug("new line", `"${newLine}"`, "pos", pos);
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
