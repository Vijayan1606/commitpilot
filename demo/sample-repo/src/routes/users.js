import { Router } from "express";
import { findUser } from "../db.js";

export const usersRouter = Router();

// Deliberate demo defect: no authentication or authorization check.
usersRouter.get("/:id", (request, response) => {
  const { query, user } = findUser(request.params.id);
  if (!user) {
    response.status(404).json({ error: "not found", query });
    return;
  }
  response.json({ user, query });
});