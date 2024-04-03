const { webDev, webProd } = require("./webpack/webpack.web.js");
const { electronDev, electronProd } = require("./webpack/webpack.electron.js");

module.exports = (env) => {
    if (env.prod) {
        console.log("using PROD (web+electron) webpack environment");
        return [webProd, electronProd];
    }
    if (env["prod:web"]) {
        console.log("using PROD (web) webpack environment");
        return webProd;
    }
    if (env["prod:electron"]) {
        console.log("using PROD (electron) webpack environment");
        return electronProd;
    }
    if (env.dev) {
        console.log("using DEV (web+electron) webpack environment");
        return [webDev, electronDev];
    }
    if (env["dev:web"]) {
        console.log("using DEV (web) webpack environment");
        return webDev;
    }
    if (env["dev:electron"]) {
        console.log("using DEV (electron) webpack environment");
        return electronDev;
    }
    console.log("must specify a webpack environment using --env [dev|prod]");
};
