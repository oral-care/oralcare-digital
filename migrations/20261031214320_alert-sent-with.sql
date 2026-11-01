-- Each alert records whether it went out in an alert e-mail or in the daily
-- summary, so the cap of 3 alert e-mails a day can be counted (plan 8.1).
ALTER TABLE "core"."alert" ADD COLUMN "sent_with" text;--> statement-breakpoint
ALTER TABLE "core"."alert" ADD CONSTRAINT "alert_sent_with" CHECK ("core"."alert"."sent_with" is null or "core"."alert"."sent_with" in ('alert', 'summary'));
