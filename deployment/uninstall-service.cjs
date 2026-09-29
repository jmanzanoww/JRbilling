const path = require("node:path");
const { Service } = require("node-windows");
const root = path.resolve(__dirname, "..");
const svc = new Service({ name: "ISP Billing Service", script: path.join(root, "apps", "api", "dist", "server.js") });
svc.on("uninstall", () => console.log("ISP Billing Service removed."));
svc.on("notinstalled", () => console.log("ISP Billing Service is not installed."));
svc.on("error", (err) => { console.error(err); process.exitCode = 1; });
svc.uninstall();
