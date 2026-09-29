const path = require("node:path");
const fs = require("node:fs");
const { Service } = require("node-windows");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "apps", "api", "dist", "server.js");
if (!fs.existsSync(script)) {
  console.error("Build not found. Run: npm run build");
  process.exit(1);
}
const svc = new Service({
  name: "ISP Billing Service",
  description: "Local ISP Billing, Collection and Subscriber Management server",
  script,
  workingDirectory: root,
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  env: [
    { name: "NODE_ENV", value: "production" },
    { name: "TZ", value: process.env.TZ || "Asia/Manila" }
  ]
});
svc.on("install", () => { console.log("ISP Billing Service installed. Starting..."); svc.start(); });
svc.on("alreadyinstalled", () => console.log("ISP Billing Service is already installed."));
svc.on("error", (err) => { console.error(err); process.exitCode = 1; });
svc.install();
