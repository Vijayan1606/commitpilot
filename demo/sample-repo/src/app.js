import express from "express";
import { usersRouter } from "./routes/users.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/users", usersRouter);
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  return app;
}