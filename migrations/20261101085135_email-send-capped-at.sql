-- The e-mail quota records when the day's cap first refused a reservation, so
-- the guard can say when sign-in codes ran out (plan 8.2). Nullable: expand only.
ALTER TABLE "core"."email_send" ADD COLUMN "capped_at" timestamp with time zone;
