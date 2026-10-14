CREATE TABLE "bus_passage" (
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
	CONSTRAINT "bus_passage_jour_course_sequence_pk" PRIMARY KEY("jour","course","sequence")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bus_passage_course_arret_idx" ON "bus_passage" USING btree ("jour","course","arret");--> statement-breakpoint
CREATE INDEX "bus_passage_heure_idx" ON "bus_passage" USING btree ("heure_prevue");--> statement-breakpoint
-- Ajout manuel : drizzle-kit ne génère pas les vues déclarées avec .existing(). Même vue que
-- tram_troncon_observe (0003), sur les passages des bus.
CREATE VIEW "bus_troncon_observe" AS
SELECT
	a.parcours,
	a.arret_precedent AS depart,
	a.arret AS arrivee,
	a.jour,
	a.course,
	a.vehicule,
	a.heure_prevue AS arrivee_a,
	EXTRACT(EPOCH FROM a.heure_prevue - d.heure_prevue)::real AS duree_s,
	EXTRACT(HOUR FROM a.heure_prevue AT TIME ZONE 'Europe/Paris')::smallint AS heure,
	CASE EXTRACT(ISODOW FROM a.jour)
		WHEN 6 THEN 'samedi'
		WHEN 7 THEN 'dimanche'
		ELSE 'semaine'
	END AS type_jour
FROM "bus_passage" a
JOIN "bus_passage" d
	ON d.jour = a.jour AND d.course = a.course AND d.arret = a.arret_precedent;
