import * as React from "react";
import * as jotai from "jotai";
import { Provider, createStore } from "jotai";
import { atomWithObservable } from "jotai/utils";
import { Greet } from "./bindings/main/GreetService.js";
import { Events } from "@wailsio/runtime";
import * as rx from "rxjs";

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
        <div>
            <h1>Hello Wails!</h1>
            <input
                id="name"
                type="text"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Your name"
            />
            <button onClick={() => doGreet()}>Greet</button>
            <div id="result">{result}</div>
            <div id="time">{timeVal}</div>
            <div>Counter: {counterVal}</div>
        </div>
    );
};

export { App };
