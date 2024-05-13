import * as React from "react";
import * as jotai from "jotai";
import { Provider, createStore } from "jotai";
import { atomWithObservable } from "jotai/utils";
import { Greet } from "./bindings/main/GreetService.js";
import { Events } from "@wailsio/runtime";
import * as rx from "rxjs";
import { clsx } from "clsx";

import "/public/style.less";

const jotaiStore = createStore();
const counterSubject = rx.interval(1000).pipe(rx.map((i) => i));
const timeAtom = jotai.atom("No time yet");

Events.On("time", (time) => {
    jotaiStore.set(timeAtom, time.data);
});

const nameAtom = jotai.atom("");
const resultAtom = jotai.atom("");
const counterAtom = atomWithObservable(() => counterSubject, {
    initialValue: 10,
});

const App = () => {
    return (
        <Provider store={jotaiStore}>
            <AppInner />
        </Provider>
    );
};

const Tabs = () => {
    return (
        <div className="tabs">
            <div className="tab">Tab 1</div>
            <div className="tab">Tab 2</div>
            <div className="tab">Tab 3</div>
        </div>
    );
};

const Block = () => {
    return (
        <div className="block">
            <div>Block Content</div>
        </div>
    );
};

const TabContent = () => {
    return (
        <div className="tabcontent">
            <Block />
        </div>
    );
};

const Workspace = () => {
    return (
        <div className="workspace">
            <Tabs />
            <TabContent />
        </div>
    );
};

const AppInner = () => {
    const [name, setName] = jotai.useAtom(nameAtom);
    const [result, setResult] = jotai.useAtom(resultAtom);
    const counterVal = jotai.useAtomValue(counterAtom);
    const timeVal = jotai.useAtomValue(timeAtom);

    function doGreet() {
        Greet(name)
            .then((result) => {
                setResult(result);
            })
            .catch((err) => {
                console.log(err);
            });
    }

    function handleKeyDown(e: any) {
        if (e.key === "Enter") {
            doGreet();
        }
    }

    return (
        <div className="mainapp">
            <div className="titlebar"></div>
            <Workspace />
        </div>
    );
};

export { App };
