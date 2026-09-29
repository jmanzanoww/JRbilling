import "./env.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST ?? "localhost",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "ispbilling",
  password: process.env.DATABASE_PASSWORD ?? "ispbilling",
  database: process.env.DATABASE_NAME ?? "isp_billing",
  connectionLimit: 8
});

export const prisma = new PrismaClient({ adapter });
