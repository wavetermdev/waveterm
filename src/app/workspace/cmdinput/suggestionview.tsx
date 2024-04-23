import { AuxiliaryCmdView } from "./auxview";
import { GlobalModel } from "@/models";
import cn from "classnames";
import React, { useEffect } from "react";
import { observer } from "mobx-react";
import { If } from "tsx-control-statements/components";

import "./suggestionview.less";
import { getAll, getFirst } from "@/autocomplete/runtime/utils";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

export const SuggestionView: React.FC = observer(() => {
    const [selectedSuggestion, setSelectedSuggestion] = React.useState<number>(0);
    const updateScroll = (index: number) => {
        setSelectedSuggestion(index);
        const element = document.getElementsByClassName("suggestion-item")[index] as HTMLElement;
        if (element) {
            element.scrollIntoView({ block: "nearest" });
        }
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
            updateScroll(Math.max(0, selectedSuggestion - 1));
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:selectBelow", (waveEvent) => {
            updateScroll(Math.min(suggestions?.length - 1, selectedSuggestion + 1));
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:tab", (waveEvent) => {
            updateScroll(Math.min(suggestions?.length - 1, selectedSuggestion + 1));
            return true;
        });

        return () => {
            GlobalModel.keybindManager.unregisterDomain("aichat");
        };
    });

    const inputModel = GlobalModel.inputModel;
    const autocompleteModel = GlobalModel.autocompleteModel;
    const suggestions: Fig.Suggestion[] = autocompleteModel.getSuggestions();

    const closeView = () => {
        inputModel.closeAuxView();
    };

    const setSuggestion = (idx: number) => {
        autocompleteModel.applySuggestion(idx);
        autocompleteModel.loadSuggestions();
        closeView();
    };

    return (
        <AuxiliaryCmdView title="Suggestions" className="suggestions-view" onClose={closeView} scrollable={true}>
            <If condition={!suggestions}>
                <div className="no-suggestions">No suggestions</div>
            </If>
            {suggestions?.map((suggestion, idx) => (
                <option
                    key={getFirst(suggestion.name)}
                    title={suggestion.description}
                    className={cn("suggestion-item", { "is-selected": selectedSuggestion === idx })}
                    onClick={() => {
                        setSuggestion(idx);
                    }}
                >
                    {suggestion.icon} {getAll(suggestion.name).join(",")}{" "}
                    {suggestion.description ? `- ${suggestion.description}` : ""}
                </option>
            ))}
        </AuxiliaryCmdView>
    );
});
