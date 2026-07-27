import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// 1. Load the .env file from the root directory BEFORE checking the variable
dotenv.config({ path: "../../.env" });

// 2. Now process.env will have your DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});