CREATE TABLE "tram_passage" (
	"jour" date NOT NULL,
	"course" text NOT NULL,
	"sequence" smallint NOT NULL,
	"vehicule" text,
	"parcours" text NOT NULL,
	"arret" text NOT NULL,
	"arret_precedent" text,
	"heure_prevue" timestamp with time zone NOT NULL,
	"detecte_a" timestamp with time zone NOT NULL,
	"heure_theorique" timestamp with time zone,
	"previsions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "tram_passage_jour_course_sequence_pk" PRIMARY KEY("jour","course","sequence")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tram_passage_course_arret_idx" ON "tram_passage" USING btree ("jour","course","arret");--> statement-breakpoint
CREATE INDEX "tram_passage_heure_idx" ON "tram_passage" USING btree ("heure_prevue");