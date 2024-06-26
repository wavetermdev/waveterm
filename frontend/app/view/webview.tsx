// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { WebviewTag } from "electron";
import React, { useEffect, useRef, useState } from "react";

import "./webview.less";

interface WebViewProps {
    parentRef: React.MutableRefObject<HTMLDivElement>;
    initialUrl: string;
}

const WebView = ({ parentRef, initialUrl }: WebViewProps) => {
    const [url, setUrl] = useState(initialUrl);
    const [inputUrl, setInputUrl] = useState(initialUrl); // Separate state for the input field
    const [webViewHeight, setWebViewHeight] = useState(0);

    const webviewRef = useRef<WebviewTag>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const historyStack = useRef<string[]>([]);
    const historyIndex = useRef<number>(-1);

    useEffect(() => {
        const inputHeight = inputRef.current?.getBoundingClientRect().height + 25;
        const parentHeight = parentRef.current?.getBoundingClientRect().height;
        setWebViewHeight(parentHeight - inputHeight);

        historyStack.current.push(initialUrl);
        historyIndex.current = 0;

        const webview = webviewRef.current;

        const handleNavigation = (newUrl: string) => {
            const normalizedNewUrl = normalizeUrl(newUrl);
            const normalizedLastUrl = normalizeUrl(historyStack.current[historyIndex.current]);

            if (normalizedLastUrl !== normalizedNewUrl) {
                setUrl(newUrl);
                setInputUrl(newUrl); // Update input field as well
                historyIndex.current += 1;
                historyStack.current = historyStack.current.slice(0, historyIndex.current);
                historyStack.current.push(newUrl);
            }
        };

        if (webview) {
            const navigateListener = (event: any) => {
                handleNavigation(event.url);
            };

            webview.addEventListener("did-navigate", navigateListener);
            webview.addEventListener("did-navigate-in-page", navigateListener);

            // Handle new-window event
            webview.addEventListener("new-window", (event: any) => {
                event.preventDefault();
                const newUrl = event.url;
                webview.src = newUrl;
            });

            // Suppress errors
            webview.addEventListener("did-fail-load", (event: any) => {
                if (event.errorCode === -3) {
                    console.log("Suppressed ERR_ABORTED error");
                } else {
                    console.error(`Failed to load ${event.validatedURL}: ${event.errorDescription}`);
                }
            });

            // Clean up event listeners on component unmount
            return () => {
                webview.removeEventListener("did-navigate", navigateListener);
                webview.removeEventListener("did-navigate-in-page", navigateListener);
                webview.removeEventListener("new-window", (event: any) => {
                    webview.src = event.url;
                });
                webview.removeEventListener("did-fail-load", (event: any) => {
                    if (event.errorCode === -3) {
                        console.log("Suppressed ERR_ABORTED error");
                    } else {
                        console.error(`Failed to load ${event.validatedURL}: ${event.errorDescription}`);
                    }
                });
            };
        }
    }, [initialUrl]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "l") {
                event.preventDefault();
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            }
        };

        const handleResize = () => {
            const parentHeight = parentRef.current?.getBoundingClientRect().height;
            setWebViewHeight(parentHeight);
        };

        const parentElement = parentRef.current;
        if (parentElement) {
            parentElement.addEventListener("keydown", handleKeyDown);
        }
        window.addEventListener("resize", handleResize);

        return () => {
            if (parentElement) {
                parentElement.removeEventListener("keydown", handleKeyDown);
            }
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    const ensureUrlScheme = (url: string) => {
        if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
            return `https://${url}`;
        }
        return url;
    };

    const normalizeUrl = (url: string) => {
        try {
            const parsedUrl = new URL(url);
            if (parsedUrl.hostname.startsWith("www.")) {
                parsedUrl.hostname = parsedUrl.hostname.slice(4);
            }
            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, ""); // Remove trailing slashes
            parsedUrl.search = ""; // Remove query parameters
            return parsedUrl.href;
        } catch (e) {
            return url.replace(/\/+$/, ""); // Fallback for invalid URLs
        }
    };

    const navigateTo = (newUrl: string) => {
        const finalUrl = ensureUrlScheme(newUrl);
        const normalizedFinalUrl = normalizeUrl(finalUrl);
        const normalizedLastUrl = normalizeUrl(historyStack.current[historyIndex.current]);

        if (normalizedLastUrl !== normalizedFinalUrl) {
            setUrl(finalUrl);
            setInputUrl(finalUrl);
            historyIndex.current += 1;
            historyStack.current = historyStack.current.slice(0, historyIndex.current);
            historyStack.current.push(finalUrl);
            if (webviewRef.current) {
                webviewRef.current.src = finalUrl;
            }
        }
    };

    const handleBack = () => {
        if (historyIndex.current > 0) {
            historyIndex.current -= 1;
            const prevUrl = historyStack.current[historyIndex.current];
            setUrl(prevUrl);
            setInputUrl(prevUrl);
            if (webviewRef.current) {
                webviewRef.current.src = prevUrl;
            }
        }
    };

    const handleForward = () => {
        if (historyIndex.current < historyStack.current.length - 1) {
            historyIndex.current += 1;
            const nextUrl = historyStack.current[historyIndex.current];
            setUrl(nextUrl);
            setInputUrl(nextUrl);
            if (webviewRef.current) {
                webviewRef.current.src = nextUrl;
            }
        }
    };

    const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setInputUrl(event.target.value);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            navigateTo(inputUrl);
        }
    };

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        event.target.select();
    };

    return (
        <div className="webview-wrapper">
            <div className="toolbar">
                <div className="navigation">
                    <Button className="secondary ghost back" onClick={handleBack} disabled={historyIndex.current <= 0}>
                        <i className="fa-sharp fa-regular fa-arrow-left"></i>
                    </Button>
                    <Button
                        onClick={handleForward}
                        className="secondary ghost forward"
                        disabled={historyIndex.current >= historyStack.current.length - 1}
                    >
                        <i className="fa-sharp fa-regular fa-arrow-right"></i>
                    </Button>
                </div>
                <div className="url-input-wrapper">
                    <input
                        className="url-input"
                        ref={inputRef}
                        type="text"
                        value={inputUrl}
                        onChange={handleUrlChange}
                        onKeyDown={handleKeyDown}
                        onFocus={handleFocus}
                    />
                </div>
            </div>
            <webview className="webview" ref={webviewRef} src={url} style={{ height: webViewHeight }}></webview>
        </div>
    );
};

export { WebView };
