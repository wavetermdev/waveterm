// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { If, For } from "tsx-control-statements/components";
import { GlobalModel } from "@/models";

import * as lexical from "lexical";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { KeybindManager } from "@/util/keyutil";

const theme = {
    // Theme styling goes here
};

class WaveBookKeybindings extends React.Component<{}, {}> {
    componentDidMount(): void {
        const keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("pane", "wavebook", "generic:confirm", (waveEvent) => {
            return true;
        });
    }
    componentWillUnmount(): void {
        const keybindManager = GlobalModel.keybindManager;
        keybindManager.unregisterDomain("wavebook");
    }
    render() {
        return null;
    }
}

@mobxReact.observer
class WaveBookDisplay extends React.Component<{}, {}> {
    render() {
        return "playbooks";
    }
}

export { WaveBookDisplay };
