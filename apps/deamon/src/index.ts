import { createServer } from "node:http";
import { Hono } from "hono";
import { getSocketPath } from "./util/pipe.js";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const server = createServer(async (req, res) => {
  const response = await app.fetch(req as any);

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});

const socket = getSocketPath();

server.listen(socket, () => {
  console.log("Listening on unix socket " + socket);
});
