import { prisma } from "../prisma.js";
import { enqueueRouterJob, processRouterJobs } from "./router-queue.js";
import { receiptNo } from "../utils.js";
import { audit } from "../audit.js";

export type RecordPaymentInput = {
  clientId: number;
  amount: number;
  method: "CASH" | "GCASH" | "BANK_TRANSFER" | "OTHER";
  referenceNo?: string | null;
  notes?: string | null;
  actor: string;
  receivedBy?: string;
  approvedBy?: string;
  sourceSubmissionId?: number;
};

export async function recordOfficialPayment(input: RecordPaymentInput) {
  if (input.referenceNo && input.method !== "CASH") {
    const duplicate = await prisma.payment.findFirst({ where: { method: input.method, referenceNo: input.referenceNo } });
    if (duplicate) throw Object.assign(new Error(`Reference number is already used by receipt ${duplicate.receiptNo}.`), { statusCode: 409 });
  }
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, include: { mikrotikDevice: true } });
  if (!client) throw new Error("Client not found");
  const openBills = await prisma.bill.findMany({
    where: { clientId: input.clientId, balance: { gt: 0 } },
    orderBy: [{ periodStart: "asc" }, { dueDate: "asc" }]
  });

  let remaining = input.amount;
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        clientId: input.clientId,
        receiptNo: receiptNo(),
        amount: input.amount,
        method: input.method,
        referenceNo: input.referenceNo || null,
        notes: input.notes || null,
        receivedBy: input.receivedBy ?? input.actor,
        approvedBy: input.approvedBy ?? input.actor
      }
    });

    for (const bill of openBills) {
      if (remaining <= 0) break;
      const currentBalance = Number(bill.balance);
      const applied = Math.min(currentBalance, remaining);
      const nextBalance = Math.max(0, currentBalance - applied);
      await tx.paymentAllocation.create({ data: { paymentId: payment.id, billId: bill.id, amount: applied } });
      await tx.bill.update({ where: { id: bill.id }, data: { balance: nextBalance, status: nextBalance <= 0 ? "PAID" : "PARTIAL" } });
      remaining -= applied;
    }

    let creditAdded = 0;
    if (remaining > 0) {
      creditAdded = remaining;
      const nextCredit = Number(client.creditBalance) + creditAdded;
      await tx.client.update({ where: { id: input.clientId }, data: { creditBalance: nextCredit } });
      await tx.creditTransaction.create({
        data: {
          clientId: input.clientId,
          paymentId: payment.id,
          type: "ADVANCE_PAYMENT",
          amount: creditAdded,
          balanceAfter: nextCredit,
          notes: "Unapplied payment stored as client advance credit"
        }
      });
    }

    if (input.sourceSubmissionId) {
      await tx.paymentSubmission.update({
        where: { id: input.sourceSubmissionId },
        data: { paymentId: payment.id }
      });
    }

    return { payment, creditAdded };
  });

  let autoReconnect: { triggered: boolean; actionId?: number; routerJobId?: number | null } = { triggered: false };
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const remainingDebt = await prisma.bill.aggregate({ where: { clientId: input.clientId, balance: { gt: 0 } }, _sum: { balance: true } });
  const debtAfter = Number(remainingDebt._sum.balance ?? 0);
  if (client.serviceStatus === "EXTENDED") {
    // Future/not-yet-due bills must not keep a client marked EXTENDED after the specifically extended bill is settled.
    const unresolvedExtension = await prisma.billExtension.findFirst({ where: { clientId: input.clientId, bill: { balance: { gt: 0 } } }, select: { id: true } });
    if (!unresolvedExtension) await prisma.client.update({ where: { id: input.clientId }, data: { serviceStatus: "ACTIVE" } });
  }

  if (config.autoReconnectOnPayment && client.serviceStatus === "CUT" && debtAfter <= 0) {
    const reconnectAction = await prisma.$transaction(async (tx) => {
      const action = await tx.serviceAction.create({
        data: {
          clientId: input.clientId,
          type: "RECONNECT",
          previousStatus: client.serviceStatus,
          nextStatus: "RECONNECTED",
          outstandingAtAction: 0,
          reason: "Automatic reconnect after full payment",
          performedBy: input.actor
        }
      });
      await tx.client.update({ where: { id: input.clientId }, data: { serviceStatus: "RECONNECTED", ...(client.networkStatus !== "FOR_ACTIVATION" ? { networkStatus: "ACTIVE" as const } : {}) } });
      return action;
    });
    let routerJobId: number | null = null;
    if (config.mikrotikEnabled && client.mikrotikAccount) {
      const job = await enqueueRouterJob({ clientId: input.clientId, serviceActionId: reconnectAction.id, mikrotikDeviceId: client.mikrotikDeviceId, account: client.mikrotikAccount, enabled: true });
      routerJobId = job.id;
      await processRouterJobs(20);
    }
    autoReconnect = { triggered: true, actionId: reconnectAction.id, routerJobId };
    await audit("AUTO_RECONNECT_AFTER_PAYMENT", "Client", input.clientId, input.actor, autoReconnect);
  }

  return { ...result, autoReconnect };
}
