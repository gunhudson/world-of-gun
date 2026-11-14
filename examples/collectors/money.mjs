#!/usr/bin/env node
// Example collector 2: account balances (JSON) and transactions (CSV) -> `money.balance` and `money.txn`.
//   node money.mjs [--dry]
// Balances are snapshots keyed by account and date: push today's value for every account each run.
// Transactions need their own stable id (the bank's id) so the same row is never counted twice.
// Only income transactions earn XP in the world; spending is recorded as a fact and nothing more.
import { readJson, readCsv, num, stamp, push, main } from "./lib/wog.mjs";

main("money", async () => {
  const snap = readJson("accounts.json");
  const balances = snap.accounts.map((a) => ({
    ts: stamp(snap.asOf, "09:00"),
    type: "money.balance",
    source: "accounts.json",
    data: {
      account: a.id, name: a.name, kind: a.kind,            // cash | crypto | debt | asset
      value: a.value,                                       // USD; a debt is a positive number here
      date: snap.asOf, institution: a.institution,
      ...(a.currency ? { currency: a.currency, native: a.native } : {}),
    },
  }));
  const txns = readCsv("transactions.csv").filter((r) => r.id && num(r.amount) != null).map((r) => ({
    id: "ledger:txn:" + r.id,
    ts: stamp(r.date, "12:00"),
    type: "money.txn",
    source: "transactions.csv",
    data: {
      amount: num(r.amount), kind: r.kind, date: r.date,
      ...(r.kind === "income" ? { name: r.name } : { merchant: r.name, ...(r.category ? { category: r.category } : {}) }),
    },
  }));
  await push("money", [...balances, ...txns]);
});
