/*
  Warnings:

  - You are about to drop the column `address` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[appointmentId,authorId]` on the table `Review` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Review_appointmentId_key";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "isFinishedEarly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seqId" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Geral',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "address",
ADD COLUMN     "activeFeedback" TEXT,
ADD COLUMN     "activeWarning" TEXT,
ADD COLUMN     "autoCloseRegister" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoOpenRegister" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "banExpiresAt" TIMESTAMP(3),
ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "blockedBy" TEXT,
ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY['Outros']::TEXT[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "codeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'Brasil',
ADD COLUMN     "defaultFloat" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "fidelityBonus" TEXT,
ADD COLUMN     "fidelityEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fidelityGoal" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "mainCategory" TEXT NOT NULL DEFAULT 'Outros',
ADD COLUMN     "neighborhood" TEXT,
ADD COLUMN     "noShowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notificationSettings" TEXT DEFAULT '60',
ADD COLUMN     "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "pushToken" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "totalAppointments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationType" TEXT,
ADD COLUMN     "workDays" TEXT DEFAULT '1,2,3,4,5',
ADD COLUMN     "zipCode" TEXT,
ALTER COLUMN "serviceDuration" DROP NOT NULL,
ALTER COLUMN "workStart" DROP NOT NULL,
ALTER COLUMN "workStart" SET DEFAULT '08:00',
ALTER COLUMN "workEnd" DROP NOT NULL,
ALTER COLUMN "workEnd" SET DEFAULT '17:00';

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "resolverId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "adminId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegister" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "initialValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalIncome" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "finalValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "proId" TEXT NOT NULL,

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientNote_proId_clientId_key" ON "ClientNote"("proId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_appointmentId_authorId_key" ON "Review"("appointmentId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_proId_fkey" FOREIGN KEY ("proId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_proId_fkey" FOREIGN KEY ("proId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
