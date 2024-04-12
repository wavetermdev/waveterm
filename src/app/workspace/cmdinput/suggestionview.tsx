import { SuggestionBlob } from "@/autocomplete/runtime/model";
import { AuxiliaryCmdView } from "./auxview";
import { GlobalModel } from "@/models";
import cn from "classnames";
import React, { useEffect } from "react";
import { observer } from "mobx-react";

import "./suggestionview.less";

export const SuggestionView: React.FC = observer(() => {
    const [selectedSuggestion, setSelectedSuggestion] = React.useState<number>(0);
    const inputModel = GlobalModel.inputModel;
    const autocompleteModel = GlobalModel.autocompleteModel;
    const suggestions: SuggestionBlob = autocompleteModel.getAutocompleteSuggestions();

    if (!suggestions) {
        return null;
    }

    const closeView = () => {
        inputModel.closeAuxView();
    };

    const setSuggestion = (idx: number) => {
        inputModel.setCurLine(inputModel.curLine + autocompleteModel.getSuggestionCompletion(idx));
        autocompleteModel.loadAutocompleteSuggestions();
        closeView();
    };

    useEffect(() => {
        const keybindManager = GlobalModel.keybindManager;

        keybindManager.registerKeybinding("pane", "aichat", "generic:confirm", (waveEvent) => {
            setSuggestion(selectedSuggestion);
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:cancel", (waveEvent) => {
            closeView();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:selectAbove", (waveEvent) => {
            setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:selectBelow", (waveEvent) => {
            setSelectedSuggestion(Math.min(suggestions.suggestions.length - 1, selectedSuggestion + 1));
            return true;
        });

        return () => {
            GlobalModel.keybindManager.unregisterDomain("aichat");
        };
    });

    return (
        <AuxiliaryCmdView
            title="Suggestions"
            className="suggestions-view"
            onClose={() => inputModel.setActiveAuxView(null)}
        >
            {suggestions.suggestions.map((suggestion, idx) => (
                <div
                    key={suggestion.name}
                    title={suggestion.description}
                    className={cn("suggestion-item", { "is-selected": selectedSuggestion === idx })}
                    onClick={() => {
                        setSuggestion(idx);
                    }}
                >
                    {suggestion.icon} {suggestion.name} {suggestion.description ? `- ${suggestion.description}` : ""}
                </div>
            ))}
        </AuxiliaryCmdView>
    );
});
