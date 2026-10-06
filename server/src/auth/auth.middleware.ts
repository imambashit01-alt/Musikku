import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config.js";
import { verifyAccessToken } from "./auth.service.js";

declare module "express-serve-static-core" {
  interface Request {
    authUser?: { id: number; username: string };
  }
}

export function requireAuth(config: Pick<AppConfig, "jwtSecret">) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const token = request.cookies?.musikku_session;
    const user = typeof token === "string" ? verifyAccessToken(token, config.jwtSecret) : null;
    if (!user) {
      response.status(401).json({ error: "Autentikasi diperlukan." });
      return;
    }

    request.authUser = user;
    next();
  };
}
