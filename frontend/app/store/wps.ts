// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";
import { Subject } from "rxjs";
import { sendRawRpcMessage } from "./ws";

type WaveEventSubject = {
    handler: (event: WaveEvent) => void;
    scope?: string;
};

type WaveEventSubjectContainer = WaveEventSubject & {
    id: string;
};

type WaveEventSubscription = WaveEventSubject & {
    eventType: string;
};

type WaveEventUnsubscribe = {
    id: string;
    eventType: string;
};

// key is "eventType" or "eventType|oref"
const fileSubjects = new Map<string, SubjectWithRef<WSFileEventData>>();
const waveEventSubjects = new Map<string, WaveEventSubjectContainer[]>();

function wpsReconnectHandler() {
    for (const eventType of waveEventSubjects.keys()) {
        updateWaveEventSub(eventType);
    }
}

function makeWaveReSubCommand(eventType: string): RpcMessage {
    let subjects = waveEventSubjects.get(eventType);
    if (subjects == null) {
        return { command: "eventunsub", data: eventType };
    }
    let subreq: SubscriptionRequest = { event: eventType, scopes: [], allscopes: false };
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            subreq.allscopes = true;
            subreq.scopes = [];
            break;
        }
        subreq.scopes.push(scont.scope);
    }
    return { command: "eventsub", data: subreq };
}

function updateWaveEventSub(eventType: string) {
    const command = makeWaveReSubCommand(eventType);
    // console.log("updateWaveEventSub", eventType, command);
    sendRawRpcMessage(command);
}

function waveEventSubscribe(...subscriptions: WaveEventSubscription[]): () => void {
    const unsubs: WaveEventUnsubscribe[] = [];
    const eventTypeSet = new Set<string>();
    for (const subscription of subscriptions) {
        // console.log("waveEventSubscribe", subscription);
        if (subscription.handler == null) {
            return;
        }
        const id: string = crypto.randomUUID();
        let subjects = waveEventSubjects.get(subscription.eventType);
        if (subjects == null) {
            subjects = [];
            waveEventSubjects.set(subscription.eventType, subjects);
        }
        const subcont: WaveEventSubjectContainer = { id, handler: subscription.handler, scope: subscription.scope };
        subjects.push(subcont);
        unsubs.push({ id, eventType: subscription.eventType });
        eventTypeSet.add(subscription.eventType);
    }
    for (const eventType of eventTypeSet) {
        updateWaveEventSub(eventType);
    }
    return () => waveEventUnsubscribe(...unsubs);
}

function waveEventUnsubscribe(...unsubscribes: WaveEventUnsubscribe[]) {
    const eventTypeSet = new Set<string>();
    for (const unsubscribe of unsubscribes) {
        let subjects = waveEventSubjects.get(unsubscribe.eventType);
        if (subjects == null) {
            return;
        }
        const idx = subjects.findIndex((s) => s.id === unsubscribe.id);
        if (idx === -1) {
            return;
        }
        subjects.splice(idx, 1);
        if (subjects.length === 0) {
            waveEventSubjects.delete(unsubscribe.eventType);
        }
        eventTypeSet.add(unsubscribe.eventType);
    }

    for (const eventType of eventTypeSet) {
        updateWaveEventSub(eventType);
    }
}

function getFileSubject(zoneId: string, fileName: string): SubjectWithRef<WSFileEventData> {
    const subjectKey = zoneId + "|" + fileName;
    let subject = fileSubjects.get(subjectKey);
    if (subject == null) {
        subject = new Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                fileSubjects.delete(subjectKey);
            }
        };
        fileSubjects.set(subjectKey, subject);
    }
    subject.refCount++;
    return subject;
}

function handleWaveEvent(event: WaveEvent) {
    // console.log("handleWaveEvent", event);
    const subjects = waveEventSubjects.get(event.event);
    if (subjects == null) {
        return;
    }
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            scont.handler(event);
            continue;
        }
        if (event.scopes == null) {
            continue;
        }
        if (event.scopes.includes(scont.scope)) {
            scont.handler(event);
        }
    }
}

export { getFileSubject, handleWaveEvent, waveEventSubscribe, waveEventUnsubscribe, wpsReconnectHandler };
