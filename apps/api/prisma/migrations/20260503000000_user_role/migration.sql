-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';

-- Promote initial admin
UPDATE "User" SET "role" = 'ADMIN' WHERE LOWER("email") = 'bhattaraiashok101@gmail.com';
