-- Propositions IA déjà enregistrées : `traversee` (un passage ou null) devient `passages` (liste).
CREATE FUNCTION pg_temp.passages_pietons(resultat jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN jsonb_typeof(resultat -> 'branches') = 'array' THEN jsonb_set(resultat, '{branches}', coalesce((
    SELECT jsonb_agg(
             (b - 'traversee') || jsonb_build_object('passages',
               CASE WHEN jsonb_typeof(b -> 'traversee') = 'array' THEN jsonb_build_array(b -> 'traversee') ELSE '[]'::jsonb END)
             ORDER BY n)
    FROM jsonb_array_elements(resultat -> 'branches') WITH ORDINALITY AS t(b, n)
  ), '[]'::jsonb)) ELSE resultat END
$$;
--> statement-breakpoint
UPDATE analyse_ia SET resultat = pg_temp.passages_pietons(resultat) WHERE resultat IS NOT NULL;
--> statement-breakpoint
UPDATE essai_ia SET resultat = pg_temp.passages_pietons(resultat) WHERE resultat IS NOT NULL;
