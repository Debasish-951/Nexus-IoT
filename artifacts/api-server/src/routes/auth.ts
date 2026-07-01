import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logActivity } from "./activity_log";

const router: IRouter = Router();

// Human login. No API keys, no server-side session — verifies the credential
// against the users table (plaintext, matching the change-password endpoint)
// and returns the sanitized user for the frontend to hold as its identity.
router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body as Record<string, unknown>;

  if (typeof username !== "string" || typeof password !== "string" || !username.trim()) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  const id = username.trim();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(or(eq(usersTable.username, id), eq(usersTable.email, id)));

  if (!user || user.status !== "active" || user.passwordHash !== password) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));
  void logActivity("user.login", "user", user.id, user.fullName, `role=${user.role}`, req);

  res.json({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  });
});

export default router;
