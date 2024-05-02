import { AuxiliaryCmdView } from "./auxview";
import { GlobalModel } from "@/models";
import { clsx } from "clsx";
import React, { useEffect } from "react";
import { observer } from "mobx-react";
import { If } from "tsx-control-statements/components";
import { action } from "mobx";

import "./suggestionview.less";
import { getAll, getFirst } from "@/autocomplete/runtime/utils";

export const AutocompleteSuggestionView: React.FC = observer(() => {
    const inputModel = GlobalModel.inputModel;
    const autocompleteModel = GlobalModel.autocompleteModel;
    const selectedSuggestion = autocompleteModel.getPrimarySuggestionIndex();

    const updateScroll = action((index: number) => {
        autocompleteModel.setPrimarySuggestionIndex(index);
        const element = document.getElementsByClassName("suggestion-item")[index] as HTMLElement;
        if (element) {
            element.scrollIntoView({ block: "nearest" });
        }
    });

    const closeView = action(() => {
        inputModel.closeAuxView();
    });

    const setSuggestion = action((idx: number) => {
        autocompleteModel.applySuggestion(idx);
        autocompleteModel.loadSuggestions();
        closeView();
    });

    useEffect(() => {
        const keybindManager = GlobalModel.keybindManager;

        keybindManager.registerKeybinding("pane", "autocomplete", "generic:confirm", (waveEvent) => {
            setSuggestion(selectedSuggestion);
            return true;
        });
        keybindManager.registerKeybinding("pane", "autocomplete", "generic:cancel", (waveEvent) => {
            closeView();
            return true;
        });
        keybindManager.registerKeybinding("pane", "autocomplete", "generic:selectAbove", (waveEvent) => {
            updateScroll(Math.max(0, selectedSuggestion - 1));
            return true;
        });
        keybindManager.registerKeybinding("pane", "autocomplete", "generic:selectBelow", (waveEvent) => {
            updateScroll(Math.min(suggestions?.length - 1, selectedSuggestion + 1));
            return true;
        });
        keybindManager.registerKeybinding("pane", "autocomplete", "generic:tab", (waveEvent) => {
            updateScroll(Math.min(suggestions?.length - 1, selectedSuggestion + 1));
            return true;
        });

        return () => {
            GlobalModel.keybindManager.unregisterDomain("autocomplete");
        };
    });

    const suggestions: Fig.Suggestion[] = autocompleteModel.getSuggestions();

    return (
        <AuxiliaryCmdView title="Suggestions" className="suggestions-view" onClose={closeView} scrollable={true}>
            <If condition={!suggestions || suggestions.length == 0}>
                <div className="no-suggestions">No suggestions</div>
            </If>
            {suggestions?.map((suggestion, idx) => (
                <option
                    key={getFirst(suggestion.name)}
                    title={suggestion.description}
                    className={clsx("suggestion-item", { "is-selected": selectedSuggestion === idx })}
                    onClick={() => {
                        setSuggestion(idx);
                    }}
                >
                    {`${suggestion.icon} ${suggestion.displayName ?? getAll(suggestion.name).join(",")} ${
                        suggestion.description ? `- ${suggestion.description}` : ""
                    }`}
                </option>
            ))}
        </AuxiliaryCmdView>
    );
});
