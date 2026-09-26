-- Migration manuelle : drizzle-kit ne génère pas les vues déclarées avec .existing().
-- Durée observée de chaque tronçon : passage à l'arrêt moins passage à l'arrêt précédent de
-- la même course. Le créneau (heure locale, type de jour) sert aux statistiques ; le type de
-- jour suit le jour de service, pas l'horloge (une course après minuit reste celle de la veille).
CREATE VIEW "tram_troncon_observe" AS
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
FROM "tram_passage" a
JOIN "tram_passage" d
	ON d.jour = a.jour AND d.course = a.course AND d.arret = a.arret_precedent;
