import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { ipcMain } from "electron";

const docsiteWebUrl = "https://docs.waveterm.dev/";
let docsiteUrl: string;

ipcMain.on("get-docsite-url", (event) => {
    event.returnValue = docsiteUrl;
});

export async function initDocsite() {
    const docsiteLocalUrl = getWebServerEndpoint() + "/docsite/";
    console.log("docsiteLocalUrl", docsiteLocalUrl);
    try {
        const response = await fetch(docsiteLocalUrl);
        if (response.ok) {
            console.log("Local docsite is running, using local site for help view");
            docsiteUrl = docsiteLocalUrl;
        } else {
            console.log("Local docsite is not running, using hosted site for help view", response);
            docsiteUrl = docsiteWebUrl;
        }
    } catch (error) {
        console.log("Failed to fetch docsite url, using web site for help view", error);
        docsiteUrl = docsiteWebUrl;
    }
}
