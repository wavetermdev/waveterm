// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { getApi } from "@/app/store/global";
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
    const [isLoading, setIsLoading] = useState(false);

    const webviewRef = useRef<WebviewTag>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const historyStack = useRef<string[]>([]);
    const historyIndex = useRef<number>(-1);
    const recentUrls = useRef<{ [key: string]: number }>({});

    const getWebViewHeight = () => {
        const inputHeight = inputRef.current?.getBoundingClientRect().height;
        const parentHeight = parentRef.current?.getBoundingClientRect().height;
        return parentHeight - (inputHeight + 35);
    };

    useEffect(() => {
        const webviewHeight = getWebViewHeight();
        setWebViewHeight(webviewHeight);

        historyStack.current.push(initialUrl);
        historyIndex.current = 0;

        const webview = webviewRef.current;

        const handleNavigation = (newUrl: string) => {
            const normalizedNewUrl = normalizeUrl(newUrl);
            const normalizedLastUrl = normalizeUrl(historyStack.current[historyIndex.current]);

            if (normalizedLastUrl !== normalizedNewUrl) {
                setUrl(normalizedNewUrl);
                setInputUrl(normalizedNewUrl); // Update input field as well
                historyIndex.current += 1;
                historyStack.current = historyStack.current.slice(0, historyIndex.current);
                historyStack.current.push(normalizedNewUrl);
                updateRecentUrls(normalizedNewUrl);
            }
        };

        if (webview) {
            const navigateListener = (event: any) => {
                handleNavigation(event.url);
            };

            webview.addEventListener("did-navigate", navigateListener);
            webview.addEventListener("did-navigate-in-page", navigateListener);
            webview.addEventListener("did-start-loading", () => setIsLoading(true));
            webview.addEventListener("did-stop-loading", () => setIsLoading(false));

            // Handle new-window event
            webview.addEventListener("new-window", (event: any) => {
                event.preventDefault();
                const newUrl = event.detail.url;
                getApi().openExternal(newUrl);
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
            } else if ((event.ctrlKey || event.metaKey) && event.key === "r") {
                event.preventDefault();
                if (webviewRef.current) {
                    webviewRef.current.reload();
                }
            }
        };

        const handleResize = () => {
            const webviewHeight = getWebViewHeight();
            setWebViewHeight(webviewHeight);
        };

        const parentElement = parentRef.current;
        if (parentElement) {
            parentElement.addEventListener("keydown", handleKeyDown);
        }

        // Use ResizeObserver to observe changes in the height of parentRef
        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                if (entry.target === parentElement) {
                    handleResize();
                }
            }
        });

        resizeObserver.observe(parentElement);

        return () => {
            if (parentElement) {
                parentElement.removeEventListener("keydown", handleKeyDown);
            }
            resizeObserver.disconnect();
        };
    }, []);

    const ensureUrlScheme = (url: string) => {
        if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?/.test(url)) {
            // If the URL starts with localhost or an IP address (with optional port)
            return `http://${url}`;
        } else if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
            // If the URL doesn't start with a protocol
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

            // Ensure pathname ends with a trailing slash
            if (!parsedUrl.pathname.endsWith("/")) {
                parsedUrl.pathname += "/";
            }

            // Ensure hash fragments end with a trailing slash
            if (parsedUrl.hash && !parsedUrl.hash.endsWith("/")) {
                parsedUrl.hash += "/";
            }

            // Ensure search parameters end with a trailing slash
            if (parsedUrl.search && !parsedUrl.search.endsWith("/")) {
                parsedUrl.search += "/";
            }

            return parsedUrl.href;
        } catch (e) {
            return url.replace(/\/+$/, "") + "/";
        }
    };

    const navigateTo = (newUrl: string) => {
        const finalUrl = ensureUrlScheme(newUrl);
        const normalizedFinalUrl = normalizeUrl(finalUrl);
        const normalizedLastUrl = normalizeUrl(historyStack.current[historyIndex.current]);

        if (normalizedLastUrl !== normalizedFinalUrl) {
            setUrl(normalizedFinalUrl);
            setInputUrl(normalizedFinalUrl);
            historyIndex.current += 1;
            historyStack.current = historyStack.current.slice(0, historyIndex.current);
            historyStack.current.push(normalizedFinalUrl);
            if (webviewRef.current) {
                webviewRef.current.src = normalizedFinalUrl;
            }
            updateRecentUrls(normalizedFinalUrl);
        }
    };

    const handleBack = () => {
        if (historyIndex.current > 0) {
            do {
                historyIndex.current -= 1;
            } while (historyIndex.current > 0 && isRecentUrl(historyStack.current[historyIndex.current]));

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
            do {
                historyIndex.current += 1;
            } while (
                historyIndex.current < historyStack.current.length - 1 &&
                isRecentUrl(historyStack.current[historyIndex.current])
            );

            const nextUrl = historyStack.current[historyIndex.current];
            setUrl(nextUrl);
            setInputUrl(nextUrl);
            if (webviewRef.current) {
                webviewRef.current.src = nextUrl;
            }
        }
    };

    const handleRefresh = () => {
        if (webviewRef.current) {
            if (isLoading) {
                webviewRef.current.stop();
            } else {
                webviewRef.current.reload();
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

    const updateRecentUrls = (url: string) => {
        if (recentUrls.current[url]) {
            recentUrls.current[url]++;
        } else {
            recentUrls.current[url] = 1;
        }
        // Clean up old entries after a certain threshold
        if (Object.keys(recentUrls.current).length > 50) {
            recentUrls.current = {};
        }
    };

    const isRecentUrl = (url: string) => {
        return recentUrls.current[url] > 1;
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
                    <Button onClick={handleRefresh} className="secondary ghost refresh">
                        <i className={`fa-sharp fa-regular ${isLoading ? "fa-xmark" : "fa-rotate-right"}`}></i>
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
            <webview
                id="webview"
                className="webview"
                ref={webviewRef}
                src={url}
                style={{ height: webViewHeight }}
            ></webview>
        </div>
    );
};

export { WebView };
