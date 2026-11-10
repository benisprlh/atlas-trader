import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// This deployment is an owner-private single-workspace application. Do not
// change its audience without introducing explicit per-user authorization.
export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
export const backtests = sqliteTable("backtests", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  symbol: text("symbol").notNull(),
  source: text("source").notNull(),
  config: text("config").notNull(),
  result: text("result").notNull(),
});
