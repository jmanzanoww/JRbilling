import { prisma } from "../prisma.js";
import { dueDateFor, periodLabel, periodStartFor } from "../utils.js";

export async function generateBillsForPeriod(year: number, month: number) {
  const clients = await prisma.client.findMany({ where: { serviceStatus: { not: "INACTIVE" } } });
  let created = 0;
  let creditsApplied = 0;

  for (const client of clients) {
    const periodStart = periodStartFor(year, month);
    const dueDate = dueDateFor(year, month, client.dueDay);
    const exists = await prisma.bill.findUnique({ where: { clientId_periodStart: { clientId: client.id, periodStart } } });
    if (exists) continue;

    await prisma.$transaction(async (tx) => {
      const rate = Number(client.monthlyRate);
      const availableCredit = Number(client.creditBalance);
      const applied = Math.min(rate, availableCredit);
      const balance = rate - applied;
      const bill = await tx.bill.create({ data: {
        clientId: client.id,
        periodStart,
        periodLabel: periodLabel(year, month),
        originalDueDate: dueDate,
        dueDate,
        amountDue: rate,
        balance,
        status: balance <= 0 ? "PAID" : balance < rate ? "PARTIAL" : dueDate < new Date() ? "OVERDUE" : "UNPAID"
      } });

      if (applied > 0) {
        const nextCredit = availableCredit - applied;
        await tx.client.update({ where: { id: client.id }, data: { creditBalance: nextCredit } });
        await tx.creditTransaction.create({ data: {
          clientId: client.id,
          billId: bill.id,
          type: "AUTO_APPLY",
          amount: -applied,
          balanceAfter: nextCredit,
          notes: `Automatically applied to ${periodLabel(year, month)}`
        } });
        creditsApplied += applied;
      }
    });
    created++;
  }

  return { created, skipped: clients.length - created, creditsApplied };
}

export async function refreshOverdueStatuses() {
  const result = await prisma.bill.updateMany({
    where: { balance: { gt: 0 }, dueDate: { lt: new Date() }, status: { in: ["UNPAID", "PARTIAL"] } },
    data: { status: "OVERDUE" }
  });
  return result.count;
}
