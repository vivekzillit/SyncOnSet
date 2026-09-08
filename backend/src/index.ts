import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./lib/prisma";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (ignored, the server keeps running):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (ignored, the server keeps running):", err);
});

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Costumes & Set API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
