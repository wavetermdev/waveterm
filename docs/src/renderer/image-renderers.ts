import type { DocsPageData, ImageGeneratorOptions, ImageRenderer } from "@waveterm/docusaurus-og";
import { readFileSync } from "fs";
import { join } from "path";
import React, { ReactNode } from "react";

const waveLogo = join(__dirname, "../../static/img/logo/wave-dark.png");
const waveLogoBase64 = `data:image/png;base64,${readFileSync(waveLogo).toString("base64")}`;

const titleElement = ({ children }) =>
    React.createElement(
        "label",
        {
            style: {
                fontSize: 72,
                fontWeight: 800,
                letterSpacing: 1,
                margin: "25px 225px 10px 0px",
                color: "#e3e3e3",
                wordBreak: "break-word",
            },
        },
        children
    );

const waveLogoElement = React.createElement("img", {
    src: waveLogoBase64,
    style: {
        width: 300,
    },
});

const headerElement = (header: string, svg: ReactNode) =>
    React.createElement(
        "div",
        {
            style: {
                display: "flex",
                alignItems: "center",
                marginTop: "50px",
            },
        },
        svg,
        React.createElement(
            "label",
            {
                style: {
                    fontSize: 30,
                    fontWeight: 600,
                    letterSpacing: 1,
                    color: "#58c142",
                },
            },
            header
        )
    );

const rootDivStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: "50px 50px",
    justifyContent: "center",
    fontFamily: "Roboto",
    fontSize: 32,
    fontWeight: 400,
    backgroundColor: "#1b1b1d",
    color: "#e3e3e3",
    borderBottom: "2rem solid #58c142",
    zIndex: "2 !important",
};

export const docOgRenderer: ImageRenderer<DocsPageData> = async (data, context) => {
    const element = React.createElement(
        "div",
        { style: rootDivStyle },
        waveLogoElement,
        headerElement("Documentation", null),
        React.createElement(titleElement, null, data.metadata.title),
        React.createElement("div", null, data.metadata.description.replace("&mdash;", "-"))
    );

    return [element, await imageGeneratorOptions()];
};

const imageGeneratorOptions = async (): Promise<ImageGeneratorOptions> => {
    return {
        width: 1200,
        height: 600,
        fonts: [
            {
                name: "Roboto",
                data: await getTtfFont("Roboto", ["ital", "wght"], [0, 400]),
                weight: 400,
                style: "normal",
            },
        ],
    };
};

function docSectionPath(slug: string, title: string) {
    let section = slug.split("/")[1].toString();

    // Override some sections by slug
    switch (section) {
        case "api":
            section = "REST APIs";
            break;
    }

    section = section.charAt(0).toUpperCase() + section.slice(1);

    return `${title} / ${section}`;
}

async function getTtfFont(family: string, axes: string[], value: number[]): Promise<ArrayBuffer> {
    const familyParam = axes.join(",") + "@" + value.join(",");

    // Get css style sheet with user agent Mozilla/5.0 Firefox/1.0 to ensure TTF is returned
    const cssCall = await fetch(`https://fonts.googleapis.com/css2?family=${family}:${familyParam}&display=swap`, {
        headers: {
            "User-Agent": "Mozilla/5.0 Firefox/1.0",
        },
    });

    const css = await cssCall.text();
    const ttfUrl = css.match(/url\(([^)]+)\)/)?.[1];

    return await fetch(ttfUrl).then((res) => res.arrayBuffer());
}
