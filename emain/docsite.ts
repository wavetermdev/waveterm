import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { ipcMain } from "electron";

const docsiteWebUrl = "https://docs.waveterm.dev/";
let docsiteUrl: string;

ipcMain.on("get-docsite-url", (event) => {
    event.returnValue = docsiteUrl;
});

export async function initDocsite() {
    const docsiteEmbeddedUrl = getWebServerEndpoint() + "/docsite/";
    try {
        const response = await fetch(docsiteEmbeddedUrl);
        if (response.ok) {
            console.log("Embedded docsite is running, using embedded version for help view");
            docsiteUrl = docsiteEmbeddedUrl;
        } else {
            console.log("Embedded docsite is not running, using web version for help view", response);
            docsiteUrl = docsiteWebUrl;
        }
    } catch (error) {
        console.log("Failed to fetch docsite url, using web version for help view", error);
        docsiteUrl = docsiteWebUrl;
    }
}
