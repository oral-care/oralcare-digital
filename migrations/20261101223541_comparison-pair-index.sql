-- An index on a pair's comparisons, so Patient vs Muntra can read when the
-- difference started ("Since", plan 4.7) without scanning every run.
CREATE INDEX "comparison_pair" ON "availability"."comparison" USING btree ("clinic_id","treatment_id");
