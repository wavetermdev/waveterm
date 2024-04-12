import { SuggestionBlob } from "@/autocomplete/runtime/model";
import { AuxiliaryCmdView } from "./auxview";
import { GlobalModel } from "@/models";
import cn from "classnames";
import React, { useEffect } from "react";
import { observer } from "mobx-react";
import { If } from "tsx-control-statements/components";

import "./suggestionview.less";

export const SuggestionView: React.FC = observer(() => {
    const [selectedSuggestion, setSelectedSuggestion] = React.useState<number>(0);
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
            setSelectedSuggestion(Math.min(suggestions?.suggestions.length - 1, selectedSuggestion + 1));
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:tab", (waveEvent) => {
            setSelectedSuggestion(Math.min(suggestions?.suggestions.length - 1, selectedSuggestion + 1));
            return true;
        });

        return () => {
            GlobalModel.keybindManager.unregisterDomain("aichat");
        };
    });

    const inputModel = GlobalModel.inputModel;
    const autocompleteModel = GlobalModel.autocompleteModel;
    const suggestions: SuggestionBlob = autocompleteModel.getSuggestions();

    const closeView = () => {
        inputModel.closeAuxView();
    };

    const setSuggestion = (idx: number) => {
        autocompleteModel.applySuggestion(idx);
        autocompleteModel.loadSuggestions();
        closeView();
    };

    return (
        <AuxiliaryCmdView title="Suggestions" className="suggestions-view" onClose={closeView}>
            <If condition={!suggestions}>
                <div className="no-suggestions">No suggestions</div>
            </If>
            {suggestions?.suggestions.map((suggestion, idx) => (
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
